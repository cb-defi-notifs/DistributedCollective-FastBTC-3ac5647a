import { bip32, networks, payments } from 'bitcoinjs-lib';
import conf from '../config/config';
import * as _ from 'lodash';
import dbCtrl from "./dbCtrl";
import U from '../utils/helper';
import telegramBot from '../utils/telegram';
import BitcoinNodeWrapper from "../utils/bitcoinNodeWrapper";


class BitcoinCtrl {
    constructor() {
        this.isMainNet = conf.env === 'prod';
        this.pubKeys = conf.walletSigs.pubKeys;
        this.cosigners = conf.walletSigs.cosigners;
        this.thresholdConfirmations = conf.thresholdConfirmations;
        this.api = new BitcoinNodeWrapper(conf.node);
        this.network = this.isMainNet ? networks.bitcoin : networks.testnet;
    }

    getDerivedPubKeys(index) {
        let publicKeys = this.pubKeys.map(key => {
            const node = bip32.fromBase58(key, this.network);
            const child = node.derive(0).derive(index);
            return child.publicKey.toString('hex');
        });
        publicKeys.sort();
        publicKeys = publicKeys.map(k => Buffer.from(k, 'hex'));
        return publicKeys;
    }

    async createAddress(index, label) {
        console.log("create payment address key for "+index+" "+label);
        const publicKeys = this.getDerivedPubKeys(index);

        const payment = payments.p2sh({
            network: this.network,
            redeem: payments.p2ms({
                m: this.cosigners,
                pubkeys: publicKeys,
                network: this.network
            })
        });
        payment.label = label;
        await this.api.importNewAddress([payment]);

        return payment.address;
    }

    async checkAddress(index, label, createdDate, rescan = false) {
        const publicKeys = this.getDerivedPubKeys(index);

        const payment = payments.p2sh({
            network: this.network,
            redeem: payments.p2ms({
                m: this.cosigners,
                pubkeys: publicKeys,
                network: this.network
            })
        });

        return await this.api.checkImportAddress(payment, label, createdDate, rescan);
    }

    /**
     * Check deposit transactions for all user addresses in DB.
     * It gets incoming transactions from the node by user label. If tx has 0 confirmations, add a pending tx to db
     * Otherwise check it is confirmed when has more than [thresholdConfirmations] confirmations
     */
    async checkDepositTxs() {
        console.log("Checking deposits")
        try {
            let currentOffset = 0, checkSize = 20, completed = false;

            while (!completed) {
                const addrLabels = await dbCtrl.getUserLabels(currentOffset, checkSize);

                if (addrLabels && addrLabels.length > 0) {
                    console.log("%d users", addrLabels.length);
                    for (let adrLabel of addrLabels) {
                        const txList = await this.api.listReceivedTxsByLabel(adrLabel, 9999);

                        console.log("Address label %s has %s tx", adrLabel, (txList||[]).length);
                        for (const tx of (txList || [])) {
                            const confirmations = tx && tx.confirmations;

                            if (confirmations === 0) {
                                await this.addPendingDepositTx({
                                    address: tx.address,
                                    value: tx.value,
                                    txId: tx.txId,
                                    label: adrLabel
                                });
                            } else if (confirmations >= this.thresholdConfirmations) {
                                await this.depositTxConfirmed({
                                    address: tx.address,
                                    value: tx.value,
                                    txId: tx.txId,
                                    confirmations: confirmations,
                                    label: adrLabel
                                });
                            }
                        }
                    }
                } else {
                    completed = true;
                }

                currentOffset += checkSize;
                await U.wasteTime(1);
            }

            if (completed) {
                await U.wasteTime(20);
                this.checkDepositTxs().catch(console.error);
            }

        } catch (e) {
            console.error(e);
        }
    }

    setPendingDepositHandler(handler) {
        this.onPendingDepositHandler = handler;
    }

    setTxDepositedHandler(handler) {
        this.onTxDepositedHandler = handler;
    }

    async addPendingDepositTx({ address, value, txId, label }) {
        try {
            const added = await dbCtrl.getDeposit(txId, label);
            const user = await dbCtrl.getUserByBtcAddress(address);
            value = value / 1e8; // value needs to be stored as BTC, not sats

            if (added == null && user != null) {
                const msg = `user ${user.btcadr} has a pending deposit, tx ${txId}, value ${value} BTC`
                telegramBot.sendMessage(msg);

                await dbCtrl.addDeposit(user.label, txId, value, false);

                if (this.onPendingDepositHandler) {
                    this.onPendingDepositHandler(user.label, {
                        txHash: txId,
                        value: value,
                        status: 'pending'
                    });
                }
            }

        } catch (e) {
            console.error(e);
        }
    }

    async depositTxConfirmed({ address, value, txId, confirmations, label }) {
        try {
            const user = await dbCtrl.getUserByBtcAddress(address);
            const confirmedInDB = await dbCtrl.getDeposit(txId, label);

            if (user != null && this.onTxDepositedHandler && (confirmedInDB == null || confirmedInDB.status !== 'confirmed')) {
                
                this.onTxDepositedHandler({
                    address: user.btcadr,
                    label: user.label,
                    txHash: txId,
                    conf: confirmations,
                    val: value
                });
            }

        } catch (e) {
            console.error(e);
        }
    }
}

export default new BitcoinCtrl();

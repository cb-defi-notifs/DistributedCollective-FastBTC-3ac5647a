/**
 * Initiates rBtc withdrawals on the multisig contract
 */
import Web3 from 'web3';
import managedWalletAbi from "../config/contractAbi";
import multisigAbi from '../config/multisigAbi';
import conf from '../config/config';
import {Mutex} from 'async-mutex';
import walletManager from './walletCtrl';
import U from '../utils/helper';

class RskCtrl {
    init() {
        this.web3 = new Web3(conf.rskNode);
        this.from = conf.account.adr;
        this.max = conf.maxAmount;
        this.min = conf.minAmount;
        this.mutex = new Mutex();
        this.contract = new this.web3.eth.Contract(managedWalletAbi, conf.contractAddress);
        this.multisig = new this.web3.eth.Contract(multisigAbi, conf.multisigAddress);
        walletManager.init(this.web3);
        this.lastGasPrice = 0;
        this.submissionMutex = new Mutex();
    }

    async getBalance(adr) {
        const balWei = await this.web3.eth.getBalance(adr);
        const balBtc = this.web3.utils.fromWei(balWei, 'ether');
        return Number(balBtc);
    }

    async getBalanceSats(adr) {
        const balWei = await this.web3.eth.getBalance(adr);
        const balBtc = this.web3.utils.fromWei(balWei, 'ether');
        return Number(balBtc) * 1e8;
    }

    /**
     * Get txId from logs, from the Submission events.
     * @param receipt a transaction receipt
     * @returns {null|number} the txId or null.
     */
    getTxIdFromLogs(receipt) {
        if (receipt && receipt.transactionHash && receipt.events && receipt.events.Submission) {
            const hexTransactionId = receipt.events.Submission.raw.topics[1];
            return this.web3.utils.hexToNumber(hexTransactionId);
        }

        return null;
    }

    /**
     *
     * @param amount - in satoshi
     * @param to
     * @param extra extra data for event
     * @returns {Promise<{error: string}|{value: string, txId: number, txHash: string}>}
     * todo: fix min/max amount update
     */
    async sendRbtc(amount, to, extra = {}) {
        console.log("Trying to send " + amount + " to: " + to);

        let transferValueSatoshi = Number(amount) - conf.commission; //subtract base fee

        const variableFeeSatoshi = (transferValueSatoshi / 1000 * 2);
        transferValueSatoshi -= variableFeeSatoshi; //subtract commission

        // fixed fee + dynamic fee
        const totalFeeSatoshi = conf.commission + variableFeeSatoshi;

        transferValueSatoshi = Number(Math.max(transferValueSatoshi, 0).toFixed(0));
        console.log("transferValueSatoshi " + transferValueSatoshi)
        const bal = await this.getBalanceSats(conf.contractAddress);
        if (bal < amount) {
            console.error("Not enough balance left on the wallet " + this.from + " bal = " + bal, { to });
            return { "error": "Not enough balance left. Please contact the admin support@sovryn.app" };
        }

        //hardcoded min amount here instead of using the value from config because it makes only trouble being strict with this amount
        //eg: user calculates gas fees wrong. the amount displayed on the frontend is to encourage users do not send too little
        //but in case they do it is cheaper for us to simply process the request than deal with a refund
        if (transferValueSatoshi > conf.maxAmount * 2 || transferValueSatoshi <= 10000) {
            console.error("transfer amount outside limit", { to, transferValueSatoshi });
            return {"error": "Your transferred amount exceeded the limit."};
        }

        const transferValue = (transferValueSatoshi / 1e8).toString();
        console.log("transfer value " + transferValue)
        const weiAmount = this.web3.utils.toWei(transferValue, 'ether');
        const weiFee = this.web3.utils.toWei((totalFeeSatoshi / 1e8).toString(), 'ether');
        console.log("wei amount " + weiAmount)
        console.log("wei fee    " + weiFee)

        const receipt = await this.transferFromMultisig(weiAmount, to, {
            ...extra,
            fee: weiFee,
        });
        const txId = this.getTxIdFromLogs(receipt);

        if (txId != null) {
            console.log("Successfully transferred " + amount + " to " + to);
            return {
                txHash: receipt.transactionHash.toString(),
                txId,
                value: transferValue
            };
        } else {
            console.error("Error sending " + amount + " to: " + to);
            console.error(receipt);
            return {"error": "Error sending rsk. Please contact the admin support@sovryn.app."};
        }
    }

    async transferFromMultisigWithWallet(val, to, wallet, extra = {}) {
        const isBscTransfer = to.startsWith(conf.bscPrefix);
        console.log(`encoding function call: transfer ${val} wei to ${to}: type ${isBscTransfer ? 'bsc': 'rsk'}, extra: ${JSON.stringify(extra)}`);

        let data;
        if (! isBscTransfer) {
            if (extra.txHash && extra.vout != null && extra.fee != null) {
                let txHash = extra.txHash;
                if (!txHash.startsWith('0x')) {
                    txHash = '0x' + txHash;
                }
                data = this.web3.eth.abi.encodeFunctionCall({
                    name: 'transferToUser',
                    type: 'function',
                    inputs: [
                        {"name": "receiver", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                        {"name": "fee", "type": "uint256"},
                        {"name": "btcTxHash", "type": "bytes32"},
                        {"name": "btcTxVout", "type": "uint256"},
                    ]
                }, [to, val, extra.fee, txHash, extra.vout]);
            } else {
                console.warn("txHash/vout/fee not provided, falling back to withdrawAdmin");
                data = this.web3.eth.abi.encodeFunctionCall({
                    name: 'withdrawAdmin',
                    type: 'function',
                    inputs: [
                        {"name": "receiver", "type": "address"},
                        {"name": "amount", "type": "uint256"}
                    ]
                }, [to, val]);
            }
        }
        else {
            const receiver = to.replace(conf.bscPrefix, '');
            const extraData = this.web3.eth.abi.encodeParameter('address', receiver.toLowerCase());
            data = this.web3.eth.abi.encodeFunctionCall({
                name: 'transferToBridge',
                type: 'function',
                inputs: [
                    {"name": "bridge", "type": "address"},
                    {"name": "receiver", "type": "address"},
                    {"name": "amount",   "type": "uint256"},
                    {"name": "extraData", "type": "bytes"},
                ]
            }, [conf.bscBridgeAddress, conf.bscAggregatorAddress, val, extraData]);
        }

        console.log("getting gas price");
        this.lastGasPrice = await this.getGasPrice();

        await this.submissionMutex.acquire();
        console.log("getting transaction count")
        let nonce = null;

        for (let i = 0; i < 3; i++) {
            try {
                nonce = await this.web3.eth.getTransactionCount(wallet, 'pending');
                break;
            }
            catch (e) {
                console.error("failed to get nonce", e);
                if (i === 2) {
                    console.error("bailing out payment of %s to %s", val, to);
                    this.submissionMutex.release();
                    return {
                        "error": "unable to get nonce count from wallet account"
                    };
                }
            }
        }

        let mutexHeld = true;
        console.log("submitting transaction");
        try {
            const promiEvent = this.multisig.methods.submitTransaction(
                conf.contractAddress, 0, data
            ).send(
            {
                from: wallet,
                gas: 1000000,
                gasPrice: this.lastGasPrice,
                nonce: nonce
            }).on("transactionHash", async (transactionHash) => {
                if (mutexHeld) {
                    mutexHeld = false;
                    await U.wasteTime(3);
                    this.submissionMutex.release();
                }

                console.log("got RSK transaction hash %s", transactionHash)
            });

            return await promiEvent;
        }
        catch(e) {
            console.error("Error submitting tx", { to, val });
            console.error(e);
            return { };
        }
        finally {
            if (mutexHeld) {
                mutexHeld = false;
                this.submissionMutex.release();
            }
        }
    }

    async transferFromMultisig(val, to, extra={}) {
        console.log("transfer %s to %s", val, to)

        const wallet = await this.getWallet();
        if (wallet.length === 0) {
            return {
                error: "no wallet available to process the assignment"
            };
        }

        try {
            return await this.transferFromMultisigWithWallet(val, to, wallet, extra);
        }
        finally {
            walletManager.decreasePending(wallet);
        }
    }

    /**
     * @notice loads a free wallet from the wallet manager
     * @dev this is secured by a mutex to make sure we're never exceeding 4 pending transactions per wallet
     */
    async getWallet() {
        await this.mutex.acquire();
        let wallet = "";
        let timeout = 5 * 60 * 1000;
        try {
            //if I have to wait, any other thread needs to wait as well
            wallet = await walletManager.getFreeWallet(timeout);
        } catch (e) {
            console.error(e);
        }
        finally {
            this.mutex.release();
        }
        return wallet;
    }


    /**
     * The Rsk node does not return a valid response occassionally for a short period of time
     * Thats why the request is repeated 5 times and in case it still failes the last known gas price is returned
     */
    async getGasPrice() {
        let cnt = 0;

        while (true) {
            try {
                const gasPrice = await this.web3.eth.getGasPrice();
                return Math.round(gasPrice * 1.1); //add security buffer to avoid gasPrice too low error
            } catch (e) {
                console.error("Error retrieving gas price");
                console.error(e);
                cnt++;
                if (cnt === 5) {
                    return this.lastGasPrice;
                }
            }
        }
    }

    async getTxIdByTxHash(txHash) {
        const receipt = await this.web3.eth.getTransactionReceipt(txHash);
        const eventOpts = this.multisig._generateEventOptions("allEvents");
        const eventDecoder = this.multisig._decodeEventABI.bind(eventOpts.event);
        const events = receipt.logs.map(l => eventDecoder({ ...l }));

        for (const e of events) {
            if (e.event === 'Submission') {
                const hexTransactionId = e.raw.topics[1];
                return this.web3.utils.hexToNumber(hexTransactionId);
            }
        }

        return null;
    }
}

export default new RskCtrl();

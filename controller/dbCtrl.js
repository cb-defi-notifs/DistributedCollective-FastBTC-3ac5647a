/**
 * Database controller
 * Stores user deposits on a given Btc address and corresponding Rsk transfers
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

import {
    Bookmarks,
    DepositAddressSignature,
    Transaction,
    User
} from '../models/index';

class DbCtrl {
    async initDb(dbName) {
        const self = this;
        return new Promise((resolve, reject) => {
            const file = path.join(__dirname, '../db/' + dbName + ".db");
            this.db = new sqlite3.Database(
                file, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
                (err) => {
                    if (err) {
                        console.error(err.message, file);
                        reject(err);
                    } else {
                        console.log('Connected to the ' + dbName + ' database.');
                        self.initRepos().catch(reject).then(() => resolve());
                    }
                });
        });
    }

    /**
     * @private
     */
    async initRepos() {
        try {
            this.userRepository = new User(this.db);
            this.transactionRepository = new Transaction(this.db);
            this.bookmarkRepository = new Bookmarks(this.db);
            this.depositAddressSignatureRepository = new DepositAddressSignature(this.db);

            for (let repository of [
                this.userRepository,
                this.transactionRepository,
                this.bookmarkRepository,
                this.depositAddressSignatureRepository
            ]) {
                await repository.checkTable();
            }
        } catch (e) {
            console.error(e);
            process.exit(1);
        }
    }

    /**
     * Helpers
     **/
    async getUserByAddress(adr, bech32Only = false) {
        const user = await this.userRepository.findByAddress(adr);

        if (bech32Only && user) {
            let btcAdr = user.btcadr;

            // the user does not have bech32 address - force new user creation
            if (btcAdr && !(btcAdr.startsWith('bc') || btcAdr.startsWith('tb'))) {
                console.log('found a user, but the user does not have bech32 address');
                return null;
            }
        }

        if (user) {
            console.log("getUserByAddress: user found", user);
        } else {
            console.log("getUserByAddress: no user found");
        }

        return user;
    }

    async getUserByLabel(label) {
        return await this.userRepository.findOne({
            label: label
        });
    }

    async addUser(web3adr, btcAddress, label) {
        return await this.userRepository.insert({
            web3adr: web3adr.toString().toLowerCase(),
            btcadr: btcAddress,
            label
        });
    }

    async getUserByBtcAddress(adr) {
        return await this.userRepository.findOne({
            btcadr: adr
        });
    }

    async getDepositAddressSignatures(btcAddress) {
        return await this.depositAddressSignatureRepository.all(`
            SELECT deposit_address_signature.*
            FROM deposit_address_signature
                     JOIN user ON (user.id =
                                   deposit_address_signature.deposit_address_id)
            WHERE user.btcAdr = ?
        `, [btcAddress]);
    }

    async getUnsignedDepositAddresses(signer, limit = 10) {
        let limitString = '';

        if (limit) {
            limitString = `LIMIT ${Number(limit)}`;
        }

        // return bech32 addresses only
        return await this.userRepository.all(`
            SELECT user.*
            FROM user
            WHERE 
                (user.btcadr like 'tb%' OR user.btcadr like 'bc%') 
            AND
                NOT EXISTS(SELECT 1 FROM deposit_address_signature das
                    WHERE user.id = das.deposit_address_id
                        AND das.signer = ?
                )
            ORDER BY id DESC
            ${limitString}
        `, [signer.toLowerCase()]);
    }

    // async getNextUserId() {
    //     try {
    //         const users = await this.userRepository.find({}, {
    //             limit: 1,
    //             orderBy: {id: -1}
    //         });
    //
    //         return users && users[0] && (users[0].id + 1) || 0;
    //     } catch (e) {
    //         console.log(e);
    //         return Promise.reject(e);
    //     }
    // }
    //
    //
    // async findUsersByAdrList(addresses) {
    //     try {
    //         const users = await this.userRepository.find({
    //             btcadr: addresses
    //         });
    //
    //         return users || [];
    //     } catch (e) {
    //         console.log(e);
    //         return Promise.reject(e);
    //     }
    // }

    async addDeposit(userAdrLabel, txHash, valueBtc, isConfirmed = false, vout = -1) {
        try {
            return await this.transactionRepository.insertDepositTx({
                userAdrLabel,
                txHash,
                valueBtc,
                status: isConfirmed ? 'confirmed' : 'pending',
                vout
            });
        } catch (e) {
            console.error("error adding deposit for " + txHash + " user: " + userAdrLabel + ", value: " + valueBtc);
            console.error(e);
            throw e;
        }
    }

    async getDeposit(txHash, label, vout) {
        const criteria = {
            txHash: txHash,
            type: "deposit",
            vout: vout,
        };

        if (label) {
            criteria.userAdrLabel = label;
        }

        const found = await this.transactionRepository.findOne(criteria);
        if (found || vout === -1) {
            return found;
        }

        criteria.vout = -1;
        return await this.transactionRepository.findOne(criteria);
    }

    async getDepositHistory(userWeb3Adr) {
        const sql = "select user.id, web3adr, btcadr, valueBtc, type, transactions.dateAdded, transactions.txHash, status"
            + " from user cross join transactions on user.label = transactions.userAdrLabel "
            + "AND web3adr = ?;";

        try {
            const rows = await this.transactionRepository.all(
                sql, [userWeb3Adr.toString().toLowerCase()]
            )

            for (let row of rows) {
                row.dateAdded = new Date(row.dateAdded);
            }
            return rows;
        } catch (err) {
            console.error('Error running sql: ' + sql);
            console.error(err);

            throw new Error("Unable to retrieve deposit history");
        }
    }

    async getLastTxTimestamp() {
        const sql = "select dateAdded from transactions where type = 'deposit' order by dateAdded desc;";

        return new Promise(resolve => {
            try {
                this.db.get(sql, [], (err, result) => {
                    if (err) {
                        console.error('Error running sql: ' + sql);
                        console.error(err);
                        resolve(Date.now());
                    } else {
                        if (result && result.dateAdded) {
                            resolve(result.dateAdded);
                        } else {
                            console.log("No deposit found. Create new timestamp now()");
                            resolve(Date.now());
                        }
                    }
                });
            } catch (e) {
                console.log('Error executing sql: ' + sql);
                console.log(err);
                resolve(Date.now());
            }
        });
    }

    async confirmDeposit(txHash, label, vout) {
        try {
            return await this.transactionRepository.update({
                txHash: txHash,
                userAdrLabel: label,
                type: "deposit",
                vout: vout,
            }, {status: 'confirmed'});
        } catch (e) {
            console.error("error confirming deposit for %s", txHash)
            console.error(e);
            throw e;
        }
    }

    async updateDeposit(txHash, vout, txId, label) {
        console.log(
            "update deposit tx hash %s, txId %s, label %s",
            txHash, txId, label
        );
        return await this.transactionRepository.update({
            txHash: txHash,
            userAdrLabel: label,
            vout: vout,
            type: "deposit",
        }, {txId: txId});
    }

    async addTransferTx(userAdrLabel, txHash, valueBtc, txId) {
        return await this.transactionRepository.insertTransferTx({
            userAdrLabel,
            txHash,
            valueBtc,
            txId,
            status: 'confirmed'
        });
    }

    async getPaymentInfo(txId) {
        console.log("Get payment info for txId " + txId);

        const tx = await this.transactionRepository.getDepositByTxId(txId);

        console.log("tx", tx);
        if (!tx || !tx.userAdrLabel || !tx.txHash) {
            return {btcAdr: null, txHash: null, vout: null};
        }

        const user = await this.getUserByLabel(tx.userAdrLabel);
        console.log("payment user: ", user);

        if (!user || !user.btcadr) {
            return {
                btcAdr: null,
                txHash: null,
                vout: null,
                web3Adr: null,
                signatures: []
            };
        }

        return {
            btcAdr: user.btcadr,
            txHash: tx.txHash,
            vout: tx.vout,
            web3Adr: user.web3adr,
            signatures: await this.getDepositAddressSignatures(user.btcadr),
        };
    }

    async getUserLabels(skip = 0, size = 10) {
        const users = await this.userRepository.find({}, {
            offset: skip,
            limit: size
        });

        return (users || []).map(u => u.label);
    }

    // /**
    //  * Use with caution, most likely you need to search for both txHash and userAdrLabel to make sure item is unique
    //  * @param { string[] } txHashList
    //  * @returns {Promise<unknown>}
    //  */
    // async findTx(txHashList) {
    //     return await this.transactionRepository.find({
    //         txHash: txHashList
    //     });
    // }

    async getUnmarkedTransferTx() {
        return this.transactionRepository.get(
            `SELECT * FROM transactions WHERE type = 'transfer' AND txId IS NULL`
        );
    }

    async markTransferTxId(id, txId) {
        return this.transactionRepository.update({
            id,
            type: 'transfer',
        }, {txId});
    }

    async getAllDeposits() {
        return this.transactionRepository.find({
            type: 'deposit'
        })
    }

    async getAllTransfers() {
        return this.transactionRepository.find({
            type: 'transfer',
        })
    }

    async getSum(type, date) {
        return await this.transactionRepository.sumTransacted(type, date);
    }

    async getTotalNumberOfTransactions(type, date) {
        return await this.transactionRepository.countConfirmed(type, date);
    }

    async getBookmark(key, defaultValue) {
        return await this.bookmarkRepository.getBookmark(key, defaultValue);
    }

    async setBookmark(key, value) {
        return await this.bookmarkRepository.setBookmark(key, value);
    }

    async getNumberOfUnprocessedTransactions(type) {
        return await this.transactionRepository.countUnprocessed(type);
    }

    async getUsersByAddress(address) {
        const sql = "select id, web3adr, btcadr, label, dateAdded"
            + " from user where web3adr like lower(?) or btcadr like ?;";

        try {
            const rows = await this.userRepository.all(
                sql, [address.toString(), address.toString()]
            );

            for (let row of rows) {
                row.dateAdded = new Date(row.dateAdded);
            }

            return rows;
        } catch (err) {
            console.error('Error running sql: ' + sql);
            console.error(err);

            throw new Error("Unable to retrieve deposit history");
        }
    }
}

export default new DbCtrl();

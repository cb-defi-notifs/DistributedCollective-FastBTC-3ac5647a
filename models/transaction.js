import BaseModel from './baseModel';

export default class Transaction extends BaseModel {
    constructor(db) {
        const sql = `CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userAdrLabel text,
            txHash text,
            txId INTEGER,
            valueBtc INTEGER,
            dateAdded datetime,
            status text,
            type text,
            unique(txHash, userAdrLabel)
        )`;

        super(db, 'transactions', sql);
    }

    insertDepositTx({userAdrLabel, txHash, valueBtc, status}) {
        return super.insert({
            userAdrLabel, txHash, valueBtc,
            type: "deposit",
            dateAdded: new Date(),
            status: status
        });
    }

    insertTransferTx({userAdrLabel, txHash, valueBtc, status}) {
        return super.insert({
            userAdrLabel, txHash, valueBtc,
            type: "transfer",
            dateAdded: new Date(),
            status: status
        });
    }

    async getTransactionByTxId(txId) {
        try {
            const res = await super.get("SELECT * from transactions WHERE type = 'deposit' and txId = ?", [txId]);
            console.log(res);
            return res;
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    // type should be either 'deposit' or 'tranfer'
    async sumTransacted(type, date) {
        try {
            const sql = date ? `SELECT type, SUM(valueBtc) total FROM ${this.tableName} WHERE type = ? AND status = 'confirmed' AND 
                (julianday(date(datetime(${date}/1000, 'unixepoch'))) - julianday(date(datetime(dateAdded/1000, 'unixepoch')))) = 0.0 GROUP BY type` :
                `SELECT type, SUM(valueBtc) total FROM ${this.tableName} WHERE type = ? AND status = 'confirmed' GROUP BY type`;
            const res = await this.get(sql, [type]);
            return res && res.total || 0;
        } catch (e) {
            console.error(e);
            return 0;
        }
    }

    async countConfirmed(type, date) {
        try {
            const sql = date ? `SELECT type, COUNT(*) AS ct FROM ${this.tableName} WHERE type = ? AND status = 'confirmed' AND 
                (julianday(date(datetime(${date}/1000, 'unixepoch'))) - julianday(date(datetime(dateAdded/1000, 'unixepoch')))) = 0.0 GROUP BY type` : 
                `SELECT type, COUNT(*) AS ct FROM ${this.tableName} WHERE type = ? AND status = 'confirmed' GROUP BY type`;
            const res = await this.get(sql, [type]);
            return res ? res.ct : 0;
        } catch (e) {
            console.error(e);
            return 0;
        }
    }
}

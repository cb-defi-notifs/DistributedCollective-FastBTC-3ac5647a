import telegramBot from '../secrets/telegram';
import walletSigs from "../secrets/walletSigs.main";
import node from '../secrets/btcNode';
import accounts from "../secrets/accounts";
import slaves from '../secrets/slaves';

export default {
    env: "prod",
    serverPort: 3000,
    backendUrl: "http://3.131.33.161:3000",
    appName: "FastBtcV3",
    dbName: "fastbtcv3_main",
    rskNode: "https://mainnet.sovryn.app/rpc",
    blockExplorer: "https://explorer.rsk.co",
    commission: 5000, //in sats
    minAmount: 40000, //sats, = 0.0002 btc
    maxAmount: 100000000, //sats, = 1 btc
    balanceThreshold: 0.05, //in rbtc
    telegramBot: Object.keys(telegramBot).length > 0 ? telegramBot : null,
    telegramGroupId: -1001469142339, 
    walletSigs: walletSigs,
    slaves: slaves.main,
    contractAddress: '0xC9e14126E5796e999890a4344b8e4c99Ac7002A1'.toLowerCase(),
    // bscBridgeAddress: '0x1CcAd820B6d031B41C54f1F3dA11c0d48b399581'.toLowerCase(), // TODO: RSK network RSK-BSC bridge
    // bscAggregatorAddress: '0xF300e09958cEE25453da4D7405045c43bFec602f'.toLowerCase(),  // TODO: BSC network BTCs aggregator
    multisigAddress: "0x0f279e810B95E0d425622b9b40D7bCD0B5C4B19d".toLowerCase(),
    bscPrefix: 'bsc-not-in-use:', // TODO: replace when BSC re-enabled
    account: accounts["main"],
    node: node.main,
    thresholdConfirmations: 1,
    startIndex: 9000, //multisig tx-index from which the node starts confirming withdraw requests 
    maxConfirmationsToTrack: 6,
};

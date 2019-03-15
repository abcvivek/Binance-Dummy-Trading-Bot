GraphQLClient = require('graphql-request')['GraphQLClient'];
const endpoint = 'https://hasura-crypto.jaaga.in/v1alpha1/graphql';
const ws = require('ws');
const Lokka = require('lokka').Lokka;
const Transport = require('lokka-transport-http').Transport;
const Binance = require('node-binance-api');


// Graphql Mutation using LOKKA

const headers = {
    "x-hasura-admin-secret": '********'
};

const client = new Lokka({
    transport: new Transport('https://hasura-crypto.jaaga.in/v1alpha1/graphql', { headers })
});


trades = {};
bots = {};

async function updateLocalTradesData() {

    const graphQLClient = new GraphQLClient(endpoint, {
        headers: {
            "x-hasura-admin-secret": '********',
        },
    })

    const query = `{
   requestedTrades{
    userId,
    id,
    symbol,
    buyPrice,
    buyQuantity,
    buyTrailing,
    sellPrice,
    sellQuantity,
    sellTrailing,
    buy_enabled,
    sell_enabled,
    is_complete
   }
  }
 `

    const tradesData = await graphQLClient.request(query);
    //console.log(JSON.stringify(tradesData, undefined, 2))

    tradesData.requestedTrades.map(reqTrade => {
        //console.log(reqTrade.userId, reqTrade.id);
        trades[reqTrade.id] = reqTrade;
        //console.log(trades[reqTrade.id]);
        if (!bots[reqTrade.id] && trades[reqTrade.id].is_complete === false) {
            startBot(reqTrade.id);
        }

    });

}




function startBot(tradeId) {
    console.log('Starting bot for trade with id', tradeId);
    bots[tradeId] = true;
    const userId = trades[tradeId].userId;
    console.log('Getting API keys for user with id', userId);
    // make hasura query for user's api key and secret

    const key = '192460460';
    const secretKey = 'alsfjsfjssdfg';

    // create binance instance

    const binance = new Binance().options({
        APIKEY: key,
        APISECRET: secretKey,
        useServerTime: true,
    });

    runTrade(userId, tradeId, binance);
}

async function runTrade(userId, tradeId, binance) {

    if (!userId || !tradeId || !binance) {
        console.log("You are not allowed to Run Trade");
        return false;
    }

    const symbolForTrade = trades[tradeId].symbol;
    let peak = 0;
    let low = Number.MAX_SAFE_INTEGER;

    const ws = binance.websockets.chart(symbolForTrade, "1m", (symbol, interval, chart) => {
        const tick = binance.last(chart);
        const last = chart[tick].close;
        console.log(`${symbol} : ${last}`);



        if (trades[tradeId].buy_enabled) {
            const buyPrice = trades[tradeId].buyPrice;
            const buyTrailing = trades[tradeId].buyTrailing;
            let buyFilled = trades[tradeId].buyFilled;
            const buyQuantity = trades[tradeId].buyQuantity;

            if (!buyFilled) buyFilled = 0;
            if (buyQuantity > buyFilled) {
                if (buyTrailing) {
                    // trailing is not 0 so we will attempt to use it
                    if (low >= last) {
                        low = last;
                        // skip the buy for this tick
                        console.log(`Price still decreasing, will skip this tick for ${symbol}`);
                    }
                    else if (((last - low) / low) >= buyTrailing) {
                        console.log(`Trailing buy triggered for ${symbol}`);
                        buy(userId, tradeId, last, buyQuantity, symbol);
                    }
                }
                else if (buyPrice >= last) {
                    console.log(`Price based buy triggered for ${symbol}`);
                    buy(userId, tradeId, buyPrice, buyQuantity, symbol);
                }
                else if (last > buyPrice) {
                    console.log(`Last price is high for ${symbol}`);
                }
                else {
                    console.log(`Something wrong with ${symbol}`);
                }
            }
        }


        if (trades[tradeId].sell_enabled) {
            const sellPrice = trades[tradeId].sellPrice;
            const sellTrailing = trades[tradeId].sellTrailing;
            let sellFilled = trades[tradeId].sellFilled;
            const sellQuantity = trades[tradeId].sellQuantity;

            if (!sellFilled) sellFilled = 0;
            if (sellQuantity > sellFilled) {
                if (sellTrailing) {
                    // trailing is not 0 so we will attempt to use it
                    if (last >= peak) {
                        peak = last;
                        // skip the sell for this tick
                        console.log(`Price still increasing for ${symbol}, will skip this tick`);
                    }
                    else if (((peak - last) / peak) >= sellTrailing) {
                        console.log(`Trailing sell triggered for ${symbol}`);
                        sell(userId, tradeId, last, sellQuantity, symbol);
                    }
                }
                else if (last >= sellPrice) {
                    console.log(`Price based sell triggered for ${symbol}`);
                    sell(userId, tradeId, sellPrice, sellQuantity, symbol);
                }
                else if (sellPrice > last) {
                    console.log(`Sell price is low for ${symbol}`);
                }
                else {
                    console.log(`Something went wrong with ${symbol}`);
                }
            }
        }

        if (trades[tradeId].buy_enabled === false && trades[tradeId].sell_enabled === false) {

            client.mutate(`{
            update_requestedTrades(
                where: {id: {_eq: ${trades[tradeId].id}}},
                    _set: {
                    is_complete : true
                      }
                    ){
                    affected_rows
                    }
                }`)


            bots[tradeId] = false;
            trades[tradeId].is_complete = true;
            binance.websockets.terminate(ws);
            delete ws;
        }

    });

}

function buy(userId, tradeId, buyPrice, buyQuantity, symbol) {

    if (!tradeId || !userId || !buyPrice || !buyQuantity || !symbol) {
        console.error('Incomplete info for buy');
        return false;
    }

    client.mutate(`{
            update_requestedTrades(
                where: {id: {_eq: ${trades[tradeId].id}}},
                    _set: {
                    buy_enabled : false
                      }
                    ){
                    affected_rows
                    }
                }`)

    client.mutate(`{
                insert_completedTrades(
                    objects: [
                    {
                        buyPrice: ${buyPrice}
                        buyQuantity : ${buyQuantity} 
                        linkedTo: ${tradeId}
                     }
                    ]
                ) {
                    affected_rows
                    }
                }`)


    console.log("****Sucessfully bought", symbol, tradeId, buyPrice, buyQuantity);

}

function sell(userId, tradeId, sellPrice, sellQuantity, symbol) {

    if (!tradeId || !userId || !sellPrice || !sellQuantity || !symbol) {
        console.error('Incomplete info for sell');
        return false;
    }

    client.mutate(`{
            update_requestedTrades(
                where: {id: {_eq: ${trades[tradeId].id}}},
                    _set: {
                    sell_enabled : false
                      }
                    ){
                    affected_rows
                    }
                }`)

    client.mutate(`{
                insert_completedTrades(
                    objects: [
                    {
                        sellPrice: ${sellPrice}
                        sellQuantity : ${sellQuantity} 
                        linkedTo: ${tradeId}
                     }
                    ]
                ) {
                    affected_rows
                    }
                }`)


    console.log("*****Sucessfully sold", symbol, tradeId, sellPrice, sellQuantity);

}

setInterval(updateLocalTradesData, 500);

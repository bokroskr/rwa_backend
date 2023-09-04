import express from "express";
import { createClient } from "redis";
import { json } from "body-parser";

const DEFAULT_BALANCE = 100;

interface ChargeResult {
    isAuthorized: boolean;
    remainingBalance: number;
    charges: number;
}

async function connect(): Promise<ReturnType<typeof createClient>> {
    const url = `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`;
    console.log(`Using redis URL ${url}`);
    const client = createClient({ url });
    await client.connect();
    return client;
}

async function reset(account: string): Promise<void> {
    const client = await connect();
    try {
        await client.set(`${account}/balance`, DEFAULT_BALANCE);
    } finally {
        await client.disconnect();
    }
}

async function charge(account: string, charges: number): Promise<ChargeResult> {
    const client = await connect();
    try {
        while (true) {
            await client.watch(`${account}/balance`);        
            const balance = parseInt((await client.get(`${account}/balance`)) ?? "");
            if (balance >= charges) {
                // Begin a transaction
                const transaction = client.multi();
    
                // Set the new value
                transaction.set(`${account}/balance`, balance - charges);
    
                try {
                    // Execute the transaction
                    const result = await transaction.exec();
        
                    if (result) {
                        const remainingBalance = parseInt((await client.get(`${account}/balance`)) ?? "");
                        return { isAuthorized: true, remainingBalance, charges };
                    }
                } catch (e) { // redis.exceptions.WatchError
                    // keep on trying
                }
            } else {
                return { isAuthorized: false, remainingBalance: balance, charges: 0 };
            }
        }
    } finally {
        // Unwatch the key
        await client.unwatch();
        await client.disconnect();
    }
}

export function buildApp(): express.Application {
    const app = express();
    app.use(json());
    app.post("/reset", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            await reset(account);
            console.log(`Successfully reset account ${account}`);
            res.sendStatus(204);
        } catch (e) {
            console.error("Error while resetting account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    app.post("/charge", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            const result = await charge(account, req.body.charges ?? 10);
            console.log(`Successfully charged account ${account}`);
            res.status(200).json(result);
        } catch (e) {
            console.error("Error while charging account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    return app;
}

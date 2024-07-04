import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { inject, injectable } from "tsyringe";
import { IDedicatedClientInfo } from "../models/fika/routes/raid/dedicated/IDedicatedClientInfo";
import { WebSocketServer } from "@spt-aki/servers/WebSocketServer";

@injectable()
export class FikaDedicatedRaidService {
    public dedicatedClients: Record<string, IDedicatedClientInfo>;
    public requestedSessions: Record<string, string>;

    constructor(
        @inject("WinstonLogger") protected logger: ILogger,
        @inject("WebSocketServer") protected webSocketServer: WebSocketServer,
    ) {
        this.dedicatedClients = {};
        this.requestedSessions = {};

        setInterval(() => {
            const currentTime = Date.now();

            for (const dedicatedClientSessionId in this.dedicatedClients) {
                const dedicatedClientLastPing = this.dedicatedClients[dedicatedClientSessionId].lastPing;

                if (currentTime - dedicatedClientLastPing > 16000) {
                    delete this.dedicatedClients[dedicatedClientSessionId];
                    logger.info(`Dedicated client removed: ${dedicatedClientSessionId}`);
                }
            }
        }, 5000);
    }

    public handleRequestedSessions(matchId: string): void {
        if (matchId in this.requestedSessions) {
            const userToJoin = this.requestedSessions[matchId];
            delete this.requestedSessions[matchId];

            const webSocket = this.webSocketServer.getSessionWebSocket(userToJoin);

            webSocket.send(JSON.stringify(
                {
                    type: "fikaDedicatedJoinMatch",
                    matchId: matchId
                }
            ));

            this.logger.info(`Told ${userToJoin} to join raid ${matchId}`);
        }
    }
}
import { inject, injectable } from "tsyringe";

import { FikaMatchEndSessionMessage } from "../models/enums/FikaMatchEndSessionMessages";
import { IFikaRaidServerIdRequestData } from "../models/fika/routes/raid/IFikaRaidServerIdRequestData";
import { IFikaRaidCreateRequestData } from "../models/fika/routes/raid/create/IFikaRaidCreateRequestData";
import { IFikaRaidCreateResponse } from "../models/fika/routes/raid/create/IFikaRaidCreateResponse";
import { IFikaRaidGethostResponse } from "../models/fika/routes/raid/gethost/IFikaRaidGethostResponse";
import { IFikaRaidJoinRequestData } from "../models/fika/routes/raid/join/IFikaRaidJoinRequestData";
import { IFikaRaidJoinResponse } from "../models/fika/routes/raid/join/IFikaRaidJoinResponse";
import { IFikaRaidLeaveRequestData } from "../models/fika/routes/raid/leave/IFikaRaidLeaveRequestData";
import { IFikaRaidSpawnpointResponse } from "../models/fika/routes/raid/spawnpoint/IFikaRaidSpawnpointResponse";
import { IFikaRaidSettingsResponse } from "../models/fika/routes/raid/getsettings/IFikaRaidSettingsResponse";
import { FikaMatchService } from "../services/FikaMatchService";
import { SaveServer } from "@spt-aki/servers/SaveServer";
import { FikaDedicatedRaidService } from "../services/FikaDedicatedRaidService";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { WebSocketServer } from "@spt-aki/servers/WebSocketServer";
import { IStartDedicatedRequest } from "../models/fika/routes/raid/dedicated/IStartDedicatedRequest";
import { IStartDedicatedResponse } from "../models/fika/routes/raid/dedicated/IStartDedicatedResponse";
import { IStatusDedicatedRequest } from "../models/fika/routes/raid/dedicated/IStatusDedicatedRequest";
import { IStatusDedicatedResponse } from "../models/fika/routes/raid/dedicated/IStatusDedicatedResponse";


@injectable()
export class FikaRaidController {
    constructor(
        @inject("FikaMatchService") protected fikaMatchService: FikaMatchService,
        @inject("SaveServer") protected saveServer: SaveServer,
        @inject("WebSocketServer") protected webSocketServer: WebSocketServer,
        @inject("FikaDedicatedRaidService") protected fikaDedicatedRaidService: FikaDedicatedRaidService,
        @inject("WinstonLogger") protected logger: ILogger,
    ) {
        // Do nothing
    }

    /**
     * Handle /fika/raid/create
     * @param request
     */
    public handleRaidCreate(request: IFikaRaidCreateRequestData): IFikaRaidCreateResponse {
        return {
            success: this.fikaMatchService.createMatch(request),
        };
    }

    /**
     * Handle /fika/raid/join
     * @param request
     */
    public handleRaidJoin(request: IFikaRaidJoinRequestData): IFikaRaidJoinResponse {
        this.fikaMatchService.addPlayerToMatch(request.serverId, request.profileId, { groupId: null, isDead: false });

        const match = this.fikaMatchService.getMatch(request.serverId);

        return {
            serverId: request.serverId,
            timestamp: match.timestamp,
            expectedNumberOfPlayers: match.expectedNumberOfPlayers,
            gameVersion: match.gameVersion,
            fikaVersion: match.fikaVersion,
        };
    }

    /**
     * Handle /fika/raid/leave
     * @param request
     */
    public handleRaidLeave(request: IFikaRaidLeaveRequestData): void {
        if (request.serverId === request.profileId) {
            this.fikaMatchService.endMatch(request.serverId, FikaMatchEndSessionMessage.HOST_SHUTDOWN_MESSAGE);
            return;
        }

        this.fikaMatchService.removePlayerFromMatch(request.serverId, request.profileId);
    }

    /**
     * Handle /fika/raid/gethost
     * @param request
     */
    public handleRaidGethost(request: IFikaRaidServerIdRequestData): IFikaRaidGethostResponse {
        const match = this.fikaMatchService.getMatch(request.serverId);
        if (!match) {
            return;
        }

        return {
            ip: match.ip,
            port: match.port,
        };
    }

    /**
     * Handle /fika/raid/spawnpoint
     * @param request
     */
    public handleRaidSpawnpoint(request: IFikaRaidServerIdRequestData): IFikaRaidSpawnpointResponse {
        const match = this.fikaMatchService.getMatch(request.serverId);
        if (!match) {
            return;
        }

        return {
            spawnpoint: match.spawnPoint,
        };
    }

    /**
     * Handle /fika/raid/getsettings
     * @param request
     */
    public handleRaidGetSettings(request: IFikaRaidServerIdRequestData): IFikaRaidSettingsResponse {
        const match = this.fikaMatchService.getMatch(request.serverId);
        if (!match) {
            return;
        }

        return {
            metabolismDisabled: match.raidConfig.metabolismDisabled,
            playersSpawnPlace: match.raidConfig.playersSpawnPlace
        };
    }

    /** Handle /fika/raid/dedicated/start */
    handleRaidStartDedicated(sessionID: string, info: IStartDedicatedRequest): IStartDedicatedResponse {
        if (Object.keys(this.fikaDedicatedRaidService.dedicatedClients).length == 0) {
            return {
                matchId: null,
                error: "No dedicated clients available"
            };
        }

        if (sessionID in this.fikaDedicatedRaidService.dedicatedClients) {
            return {
                matchId: null,
                error: "A dedicated client is trying to use a dedicated client?"
            };
        }

        let dedicatedClient: string | undefined = undefined;
        let dedicatedClientWs: WebSocket | undefined = undefined;

        for (const dedicatedSessionId in this.fikaDedicatedRaidService.dedicatedClients) {
            const dedicatedClientInfo = this.fikaDedicatedRaidService.dedicatedClients[dedicatedSessionId];

            if (dedicatedClientInfo.state != "ready") {
                continue;
            }

            dedicatedClientWs = this.webSocketServer.getSessionWebSocket(dedicatedSessionId);

            if(!dedicatedClientWs) {
                continue;
            }

            dedicatedClient = dedicatedSessionId;
            break;
        }

        if (!dedicatedClient) {
            return {
                matchId: null,
                error: "No dedicated clients available at this time"
            };
        }

        this.fikaDedicatedRaidService.requestedSessions[dedicatedClient] = sessionID;

        dedicatedClientWs.send(
            JSON.stringify(
            {
                type: "fikaDedicatedStartRaid",
                ...info
            }
        ));

        this.logger.info(`Sent WS to ${dedicatedClient}`);

        return {
            // This really isn't required, I just want to make sure on the client
            matchId: dedicatedClient,
            error: null
        }
    }

    /** Handle /fika/raid/dedicated/status */
    public handleRaidStatusDedicated(sessionId: string, info: IStatusDedicatedRequest): IStatusDedicatedResponse {
        this.fikaDedicatedRaidService.dedicatedClients[sessionId] =
        {
            state: info.status,
            lastPing: Date.now()
        }

        return {
            sessionId: info.sessionId,
            status: info.status
        }
    }
}

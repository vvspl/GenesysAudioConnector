import WS, { WebSocket } from 'ws';
import express, { Express, Request } from 'express';
import { verifyRequestSignature } from '../auth/authenticator';
import { Session } from './session';
import { getPort } from '../common/environment-variables';
import { SecretService } from '../services/secret-service';

/**
 * Class that Hosts the webserver and also maintains a map of Sessions
 * TODO: Make SessionMap work with a load Balancer
 */
export class Server {
    private app: Express | undefined;
    private httpServer: any;
    private wsServer: any;
    private sessionMap: Map<WebSocket, Session> = new Map();
    private secretService = new SecretService();
    private readonly enableKeyVerification = false;

    /**
     * This function starts an Express Server
     * Listens on the PORT configured in env file
     */
    start() {
        console.log(`Starting server on port: ${getPort()}`);
        // Create an express app and a server
        this.app = express();
        // Start the Server and Listen on All Endpoints
        this.httpServer = this.app.listen(getPort(),'0.0.0.0');
        // Create a WebSocket Server
        this.wsServer = new WebSocket.Server({
            noServer: true
        });
        // Handle Health Check Request
        this.app.get('/health', (_req, res) => {
            console.debug(new Date().toISOString()+`<<Health Check OK`);
            res.status(200).json({status:'ok'});
        });
        // Handle Upgrade Requests on the App Express Http Serve

        this.httpServer.on('upgrade', (request: Request, socket: any, head: any) => {
            console.log(new Date().toISOString()+`:Received a connection request from ${request.url}.`);
            // TODO: Signature Verification is Currently HardCoded - review this.
            // Verify Signature based on the Request Headers
            verifyRequestSignature(request, this.secretService)
                .then(verifyResult => {
                    // If the Signature Verification Fails, Close the Connection
                    if (verifyResult.code !== 'VERIFIED' && this.enableKeyVerification) { // <= For now always return VERIFIED for GOODKEY
                        console.log(new Date().toISOString() + ':' +'Authentication failed, closing the connection.');
                        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                        socket.destroy();
                        return;
                    }
                    // If Signature is verified then handle Upgrade Request by delegating to the WsServer Object
                    this.wsServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
                        console.log(new Date().toISOString() + ':' +'Authentication was successful.');
                        // Emit a Connection Event on the WsServer Object - even handler defined later
                        this.wsServer.emit('connection', ws, request);
                    });
                });
        });
        // Handle Connection Events on the WsServer Object - which is triggerred from the Upgrade request
        this.wsServer.on('connection', (ws: WebSocket, request: Request) => {
            console.log(new Date().toISOString() + ':' + `wsServer.on.connection.`);
            // When a Connection is Established and the signature is verified connection event is emitted on the websocket
            // The connection Event Handler initializes a Session Object and Define Event Handlers 
            // On Websocket Object
            // Define events on the webscocket object
            // Handle Close Event
            ws.on('close', () => {
                // When Websocket Connection is Closed Delete the Connection. 
                // TODO: Decide what to do with session
                const session = this.sessionMap.get(ws);
                // NEed to Double check if this is required.
                session?.close();
                console.log(new Date().toISOString() + ':' + 'WebSocket connection closed.');
                this.deleteConnection(ws);
            });
            // Handle WebSocket Error Event
            ws.on('error', (error: Error) => {
                // In the Case of Websocket Error Closing the Connection
                // TODO: Decide what to do with session in the case of Error
                const session = this.sessionMap.get(ws);
                
                session?.close();
                
                console.log(new Date().toISOString() + ':' + `WebSocket Error: ${error}`);
                ws.close();
            });
            // Handle Web Socket Message Event
            ws.on('message', (data: WS.RawData, isBinary: boolean) => {
                /**
                 * When a new Message arrives on a websocket
                 * We first check if the websocket is in OpenState
                 * If not we ignore the message
                 * Next We Find the Session corresponding to the websocket
                 * If session does not exist we send a disconnect Protocol Message and return
                 * If Session exist we check if the message is a Binary or a Text Message
                 * If its a binary Message we invoke the Binary Message Handling Method of the Session
                 * If its a non-Binary Message we invoke the Text Message Handling Method of the Session
                 */
                if (ws.readyState !== WebSocket.OPEN) {
                    console.log(new Date().toISOString() + ':' + `ws.on.message:!Websocket.OPEN`);
                    return;
                }
                const session = this.sessionMap.get(ws);
                if (!session) {
                    const dummySession: Session = new Session(ws, request.headers['audiohook-session-id'] as string, request.url);
                    console.log(new Date().toISOString() + ':' +'Session does not exist.');
                    dummySession.sendDisconnect('error', 'Session does not exist.', {});
                    return;
                }
                if (isBinary) {
                    session.processBinaryMessage(data as Uint8Array);
                } 
                else {
                    console.log(new Date().toISOString() + ':' + `ws.on.message.notBinary.processTextMessageMessage|[${data.toString()}]`);
                    session.processTextMessage(data.toString());
                }
            });

            this.createConnection(ws, request);
        });
    }
    /**
     * We create a Session Object for a Websocket Connection.
     * This method is called when a new Connection is established.
     * @param ws websocket Object from the Upgrade Request
     * @param request HttpRequest from the upgrade Request
     * @returns Session Object
     */
    private createConnection(ws: WebSocket, request:Request) {
        let session: Session | undefined = this.sessionMap.get(ws);
        // If a Session already exists for the Websocket Object we return the Session
        //TODO: Understand in which situation a Session already exist for a webocket Connection ?
        if (session) {
            return;
        }
        // Create a New Session Object for the Websocket Connection and put it in a map index by the Websocket
        // TODO: Ideally this should be map-index by audio-hook-session-id
        session = new Session(ws, request.headers['audiohook-session-id'] as string, request.url);
        console.log(new Date().toISOString() + ':' + request.headers['audiohook-session-id'] + ':' + 'Creating a new session');
        this.sessionMap.set(ws, session);
    }
    /**
     * This method is called to cleanup the session and delete its mapping from the sessionMap
     * This method is called on the websocket closed event.
     * @param ws Websocket Object
     * @returns void
     */
    private deleteConnection(ws: WebSocket) {
        // Find the Session from the Session Map indexed on the Websocket
        const session: Session | undefined = this.sessionMap.get(ws);
        // If Session doesnt exist we dont need to take any action so we return
        if (!session) {
            return;
        }
        // if session is found we close the session and delete the session from the sessionMap
        try {
            console.log(new Date().toISOString() + ':' + session.getClientSessionId() + ':' + 'session.close');
           session.close();
        } catch {
        }
        console.log(new Date().toISOString() + ':' + session.getClientSessionId() + ':' + 'Delete session from session map');
        this.sessionMap.delete(ws);
    }
}
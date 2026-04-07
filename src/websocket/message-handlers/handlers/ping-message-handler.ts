import { ClientMessage } from '../../../protocol/message';
import { Session } from '../../session';
import { MessageHandler } from '../message-handler';

export class PingMessageHandler implements MessageHandler {
    handleMessage(message: ClientMessage, session: Session) {
        
        session.sendKeepAlive();
    }
}
/*
* This class provides the authentication process the secret for a given key.
*/
export class SecretService {
    /*
    * For this implementation, we are just using a static map that holds the key/values.
    * In reality, you will want to store these somewhere else, like S3, or some other
    * secrets manager.
    */
    static secrets = new Map();

    static {
        SecretService.secrets.set(process.env.GENESYS_AUDIOHOOK_API_KEY, process.env.GENESYS_AUDIOHOOK_CLIENT_SECRET); // U2VjcmV0MQ==
    }

    getSecretForKey(key: string): Uint8Array {
        const secretString = SecretService.secrets.get(key) || '';

        //return Buffer.from(secretString);
        return Buffer.from(secretString, 'base64');
    }
}
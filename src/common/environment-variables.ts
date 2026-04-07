const DEFAULT_PORT = 8080;
const DEFAULT_MAX_BINARY_MESSAGE_SIZE = 64000; // Default maximum binary message size in bytes  
const DEFAULT_MIN_BINARY_MESSAGE_SIZE = 8000; // Default minimum binary message size in bytes
const DEFAULT_NO_INPUT_TIMEOUT = 30000; // Default no input timeout in milliseconds

export function getPort(): number {
    const envPort: string | undefined = process.env.PORT;

    
    if (envPort) {
        
        return Number(envPort);
    }

    return DEFAULT_PORT;
};

export function getMAXBinaryMessageSize(): number {
    const envMaxBinaryMessageSize: string | undefined = process.env.MAX_BINARY_MESSAGE_SIZE;

    if (envMaxBinaryMessageSize) {
        const maxBinaryMessageSize = Number(envMaxBinaryMessageSize);
        if (isNaN(maxBinaryMessageSize) || maxBinaryMessageSize <= 0) {
            console.warn(`Invalid MAX_BINARY_MESSAGE_SIZE in environment variables, using default value: ${DEFAULT_MAX_BINARY_MESSAGE_SIZE}`);
            return DEFAULT_MAX_BINARY_MESSAGE_SIZE;
        }
        return maxBinaryMessageSize;
    }

    return DEFAULT_MAX_BINARY_MESSAGE_SIZE;
}

export function getMinBinaryMessageSize(): number {
    const envMinBinaryMessageSize: string | undefined = process.env.MIN_BINARY_MESSAGE_SIZE;

    if (envMinBinaryMessageSize) {
        const minBinaryMessageSize = Number(envMinBinaryMessageSize);
        if (isNaN(minBinaryMessageSize) || minBinaryMessageSize <= 0) {
            console.warn(`Invalid MIN_BINARY_MESSAGE_SIZE in environment variables, using default value: ${DEFAULT_MIN_BINARY_MESSAGE_SIZE}`);
            return DEFAULT_MIN_BINARY_MESSAGE_SIZE;
        }
        return minBinaryMessageSize;
    }

    return DEFAULT_MIN_BINARY_MESSAGE_SIZE;
}

export function getNoInputTimeout(): number {
    const envNoInputTimeout: string | undefined = process.env.NO_INPUT_TIMEOUT;

    if (envNoInputTimeout) {
        const noInputTimeout = Number(envNoInputTimeout);
        if (isNaN(noInputTimeout) || noInputTimeout <= 0) {
            console.warn(`Invalid NO_INPUT_TIMEOUT in environment variables, using default value: ${DEFAULT_NO_INPUT_TIMEOUT}`);
            return DEFAULT_NO_INPUT_TIMEOUT;
        }
        return noInputTimeout;
    }

    return DEFAULT_NO_INPUT_TIMEOUT;
}
// src/gcAuth.ts
import axios, { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

const HTTP_REQ_TIMEOUT: number = 30_000;

/**
 * Verify if the Genesys Cloud token is still valid.
 * @param gcRegion - The Genesys Cloud region (e.g. "mypurecloud.com").
 * @param gcToken - The OAuth access token to verify.
 * @returns `true` if the token is valid, otherwise `false`.
 * @throws if gcRegion is unset or if the HTTP request itself errors.
 */
export async function verifyGCToken(
  gcRegion: string,
  gcToken: string
): Promise<boolean> {
  if (!gcRegion) {
    throw new Error('Unset GC Region');
  }

  if (!gcToken) {
    return false;
  }

  const url = `https://api.${gcRegion}/api/v2/tokens/me`;
  const config: AxiosRequestConfig = {
    method: 'HEAD',
    url,
    timeout: HTTP_REQ_TIMEOUT,
    maxRedirects: 0,
    headers: {
      Authorization: `Bearer ${gcToken}`,
    },
  };

  try {
    const response: AxiosResponse = await axios.request(config);
    return response.status >= 200 && response.status < 300;
  } catch (err) {
    console.error(`ERROR verifying GC token:`, err);
    // rethrow so callers know something went wrong
    throw err;
  }
}

/**
 * Acquire a new Genesys Cloud OAuth client-credentials token.
 * @param gcRegion - The Genesys Cloud region (e.g. "mypurecloud.com").
 * @param gcClientId - OAuth client ID.
 * @param gcClientSecret - OAuth client secret.
 * @returns A fresh access token.
 * @throws on missing parameters or failed HTTP request.
 */
export async function requestGCToken(
  gcRegion: string,
  gcClientId: string,
  gcClientSecret: string
): Promise<string> {
  if (!gcRegion) {
    throw new Error('Unset GC Region');
  }
  if (!gcClientId) {
    throw new Error('Unset GC Client ID');
  }
  if (!gcClientSecret) {
    throw new Error('Unset GC Client Secret');
  }

  const url = `https://login.${gcRegion}/oauth/token`;
  const basicAuth = Buffer.from(`${gcClientId}:${gcClientSecret}`).toString('base64');
  const config: AxiosRequestConfig = {
    method: 'POST',
    url,
    timeout: HTTP_REQ_TIMEOUT,
    maxRedirects: 0,
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data: 'grant_type=client_credentials',
  };

  try {
    const response: AxiosResponse = await axios.request(config);
    if (response.status >= 200 && response.status < 300 && response.data?.access_token) {
      return response.data.access_token as string;
    }
    throw new Error('Failed to get GC Token');
  } catch (err) {
    console.error(`ERROR requesting GC token:`, err);
    throw err;
  }
}

/**
 * Pretty-print REST API errors from Axios.
 * @param config - The Axios request config that was used.
 * @param error - The Axios error caught.
 */
export function printRESTAPIError(
  config: AxiosRequestConfig,
  error: AxiosError
): void {
  const method = config.method?.toUpperCase() ?? 'UNKNOWN';
  const url = config.url ?? 'UNKNOWN_URL';
  const message = error.message;
  const reqConfig = JSON.stringify(config, null, 2);
  const respHeaders = error.response?.headers
    ? JSON.stringify(error.response.headers, null, 2)
    : 'No response headers';
  const respData = error.response?.data
    ? JSON.stringify(error.response.data, null, 2)
    : 'No response data';

  console.error(
    `Error executing REST API Request: ${method} ${url}
Message: ${message}
Request Config: ${reqConfig}
Response Headers: ${respHeaders}
Response Data: ${respData}`
  );
}

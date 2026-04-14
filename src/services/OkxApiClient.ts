import axios, { AxiosInstance } from "axios";
import CryptoJS from "crypto-js";
import dotenv from "dotenv";

dotenv.config();

/**
 * Shared HTTP client for OKX Onchain OS API.
 * Handles HMAC-SHA256 signature generation required by all OKX endpoints.
 */
export class OkxApiClient {
  private client: AxiosInstance;
  private apiKey: string;
  private secretKey: string;
  private passphrase: string;
  private projectId: string;

  constructor() {
    this.apiKey = process.env.OKX_API_KEY || "";
    this.secretKey = process.env.OKX_SECRET_KEY || "";
    this.passphrase = process.env.OKX_PASSPHRASE || "";
    this.projectId = process.env.OKX_PROJECT_ID || "";

    this.client = axios.create({
      baseURL: "https://web3.okx.com",
      timeout: 15000,
    });
  }

  /**
   * Generate OKX API signature headers.
   * Format: base64(HMAC-SHA256(timestamp + method + path + body, secretKey))
   */
  private getHeaders(method: string, path: string, body: string = ""): Record<string, string> {
    const timestamp = new Date().toISOString();
    const preHash = timestamp + method.toUpperCase() + path + body;
    const signature = CryptoJS.enc.Base64.stringify(
      CryptoJS.HmacSHA256(preHash, this.secretKey)
    );

    return {
      "OK-ACCESS-KEY": this.apiKey,
      "OK-ACCESS-SIGN": signature,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": this.passphrase,
      "OK-ACCESS-PROJECT": this.projectId,
      "Content-Type": "application/json",
    };
  }

  /**
   * Make a GET request to OKX API with proper authentication.
   */
  async get<T = any>(path: string, params?: Record<string, string>): Promise<T> {
    const queryString = params
      ? "?" + new URLSearchParams(params).toString()
      : "";
    const fullPath = path + queryString;
    const headers = this.getHeaders("GET", fullPath);

    const response = await this.client.get(fullPath, { headers });
    return response.data;
  }

  /**
   * Make a POST request to OKX API with proper authentication.
   */
  async post<T = any>(path: string, body: any): Promise<T> {
    const bodyStr = JSON.stringify(body);
    const headers = this.getHeaders("POST", path, bodyStr);

    const response = await this.client.post(path, body, { headers });
    return response.data;
  }
}

// Singleton instance
export const okxApi = new OkxApiClient();

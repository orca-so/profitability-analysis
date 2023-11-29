import type { AxiosRequestConfig } from "axios";
import axios from "axios";

export const COINGECKO_PRO_API_KEY = process.env.COINGECKO_PRO_API_KEY;
export const COINGECKO_API_BASE_URL = COINGECKO_PRO_API_KEY
  ? "https://pro-api.coingecko.com/api/v3"
  : "https://api.coingecko.com/api/v3";

export const coingecko = axios.create({
  baseURL: COINGECKO_API_BASE_URL,
});

export function getCoinsListRequest(): AxiosRequestConfig {
  return {
    url: "/coins/list",
    method: "get",
    params: {
      include_platform: true,
      x_cg_pro_api_key: COINGECKO_PRO_API_KEY,
    },
  };
}

export function getHistoricalPriceRequest(coinId: string, startTime: number, endTime: number): AxiosRequestConfig {
  return {
    url: `/coins/${coinId}/market_chart/range`,
    method: "get",
    params: {
      vs_currency: "usd",
      from: startTime,
      to: endTime,
      x_cg_pro_api_key: COINGECKO_PRO_API_KEY,
    },
  };
}

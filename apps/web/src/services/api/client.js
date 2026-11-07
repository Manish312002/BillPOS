import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
const apiPrefix = import.meta.env.VITE_API_PREFIX || '/api';

export const apiClient = axios.create({
  baseURL: `${baseURL}${apiPrefix}`,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Request interceptor for logging in development
apiClient.interceptors.request.use(
  (config) => {
    config.metadata = { startTime: new Date() };
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for consistent response and error handling
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    const formattedError = {
      message: error.response?.data?.message || error.message || 'Network request failed',
      status: error.response?.status || null,
      code: error.response?.data?.code || 'NETWORK_ERROR',
      data: error.response?.data || null,
    };
    return Promise.reject(formattedError);
  }
);

export default apiClient;

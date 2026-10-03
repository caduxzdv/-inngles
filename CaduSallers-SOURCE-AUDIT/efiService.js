const axios = require('axios');

class EfiService {
    constructor(settings) {
        this.clientId = settings.efi.clientId;
        this.clientSecret = settings.efi.clientSecret;
        this.certificatePath = settings.efi.certificatePath;
        this.keyPath = settings.efi.keyPath;
        this.pixKey = settings.efi.pixKey;
        this.environment = settings.efi.environment || 'homologacao';

        // Efí API endpoints
        this.baseUrl = this.environment === 'producao'
            ? 'https://api.efipay.com.br'
            : 'https://sandbox.efipay.com.br';
    }

    /**
     * Get access token from Efí API
     */
    async getAccessToken() {
        try {
            const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

            const response = await axios.post(
                `${this.baseUrl}/oauth/token`,
                'grant_type=client_credentials',
                {
                    headers: {
                        'Authorization': `Basic ${auth}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            return response.data.access_token;
        } catch (error) {
            console.error('❌ Efí authentication error:', error.response?.data || error.message);
            throw new Error('Falha ao autenticar com a Efí');
        }
    }

    /**
     * Create a Pix charge (cobrança imediata)
     * @param {Object} chargeData - Charge information
     * @returns {Object} Created charge data
     */
    async createCharge(chargeData) {
        try {
            const accessToken = await this.getAccessToken();

            const response = await axios.post(
                `${this.baseUrl}/v2/cob`,
                chargeData,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('❌ Efí charge creation error:', error.response?.data || error.message);
            throw new Error('Falha ao criar cobrança Pix');
        }
    }

    /**
     * Get charge details by txid
     * @param {string} txid - Transaction ID
     * @returns {Object} Charge details
     */
    async getCharge(txid) {
        try {
            const accessToken = await this.getAccessToken();

            const response = await axios.get(
                `${this.baseUrl}/v2/cob/${txid}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('❌ Efí get charge error:', error.response?.data || error.message);
            throw new Error('Falha ao consultar cobrança');
        }
    }

    /**
     * Get Pix QR Code and copia e cola
     * @param {string} txid - Transaction ID
     * @returns {Object} QR Code and copia e cola data
     */
    async getPixQRCode(txid) {
        try {
            const accessToken = await this.getAccessToken();

            const response = await axios.get(
                `${this.baseUrl}/v2/cob/${txid}/qrcode`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('❌ Efí QR code error:', error.response?.data || error.message);
            throw new Error('Falha ao gerar QR Code Pix');
        }
    }

    /**
     * Cancel a charge (if possible)
     * @param {string} txid - Transaction ID
     * @returns {Object} Cancellation result
     */
    async cancelCharge(txid) {
        try {
            const accessToken = await this.getAccessToken();

            const response = await axios.delete(
                `${this.baseUrl}/v2/cob/${txid}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('❌ Efí cancel charge error:', error.response?.data || error.message);
            // Some charges cannot be cancelled (already paid, etc.)
            throw new Error('Falha ao cancelar cobrança');
        }
    }
}

module.exports = EfiService;
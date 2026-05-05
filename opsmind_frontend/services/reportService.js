/**
 * OpsMind - Report Service
 *
 * Mirrors reportandanalysis-service routes exactly:
 * - GET /technician/:technicianId
 * - POST /solution/:ticketId
 * - GET /report/:ticketId
 */

import AuthService from './authService.js';

const REPORT_API_BASE_URL = (
    (typeof window !== 'undefined' && window.OPSMIND_REPORT_API_URL) ? window.OPSMIND_REPORT_API_URL :
    'http://localhost:3006/analytics'
).replace(/\/+$/, '');

function getAxios() {
    if (typeof window === 'undefined' || !window.axios) {
        throw new Error('Axios is required for report service requests');
    }

    return window.axios;
}

function getHeaders() {
    return AuthService.getAuthHeaders();
}

function getFileName(disposition, ticketId) {
    const match = String(disposition || '').match(/filename="?([^"]+)"?/i);
    return match?.[1] || `report-${ticketId}.pdf`;
}

const ReportService = {
    async getMyTickets(technicianId) {
        const response = await getAxios().get(
            `${REPORT_API_BASE_URL}/technician/${technicianId}`,
            { headers: getHeaders() }
        );

        return response.data;
    },

    async getAllReports() {
        const response = await getAxios().get(
            `${REPORT_API_BASE_URL}/admin/reports`,
            { headers: getHeaders() }
        );

        return response.data;
    },

    async addSolution(ticketId, solution) {
        const response = await getAxios().post(
            `${REPORT_API_BASE_URL}/solution/${ticketId}`,
            { solution },
            { headers: getHeaders() }
        );

        return response.data;
    },

    async downloadPDF(ticketId) {
        const response = await getAxios().get(
            `${REPORT_API_BASE_URL}/report/${ticketId}`,
            {
                headers: getHeaders(),
                responseType: 'blob'
            }
        );

        const blobUrl = window.URL.createObjectURL(response.data);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = getFileName(response.headers?.['content-disposition'], ticketId);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(blobUrl);

        return response;
    }
};

Object.freeze(ReportService);

export default ReportService;

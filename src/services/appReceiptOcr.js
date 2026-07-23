import { supabase } from '../contexts/AuthContext';
import { createReceiptOcrClient } from './receiptOcr';

export const receiptOcrClient = createReceiptOcrClient({
  endpoint: import.meta.env.VITE_RECEIPT_OCR_URL,
  supabase,
});

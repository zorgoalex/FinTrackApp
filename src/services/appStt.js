import { supabase } from '../contexts/AuthContext';
import { createSttClient } from './stt';

export const sttClient = createSttClient(supabase.functions);

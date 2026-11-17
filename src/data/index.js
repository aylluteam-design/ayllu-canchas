import { crearLocal } from './local.js';
import { crearSupabase } from './supabase.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Con las dos variables → modo real (Supabase). Sin ellas → modo demo (datos en el navegador).
export const api = url && key ? crearSupabase(url, key) : crearLocal();

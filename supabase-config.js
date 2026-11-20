// supabase-config.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// Ganti dua nilai di bawah ini dengan kredensial project Supabase Anda
// Lokasi: Dashboard Supabase > Project Settings (ikon gerigi) > API
const SUPABASE_URL = "https://prdsvvzdulciilkufhgc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByZHN2dnpkdWxjaWlsa3VmaGdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxNTMwODAsImV4cCI6MjExMDcyOTA4MH0.cxfhppTAHvqYkePiZBLLVrjVZKu2KUX8bmlxbL5qRwY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

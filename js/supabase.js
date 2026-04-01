import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const SUPABASE_URL = 'https://jmorifdjtmmmobilhaxm.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imptb3JpZmRqdG1tbW9iaWxoYXhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMDMzNzcsImV4cCI6MjA4OTc3OTM3N30.Qna_uPlVzE5FRc1XllOVio8HpVcHrkKSzlpyN3GFgho'

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
)

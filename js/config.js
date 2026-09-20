/* Badr Grappling — runtime configuration.
 *
 * The Supabase anon key is a public, row-level-security-gated key. It is
 * meant to ship in the browser bundle. Nothing secret belongs in this file:
 * the service-role key, the Stripe secret key and the webhook signing secret
 * all live as environment variables on Cloudflare Pages. See README.md.
 */
export const CONFIG = {
  SUPABASE_URL: 'https://zipvtslqgjvavfavupzr.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppcHZ0c2xxZ2p2YXZmYXZ1cHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MzAwNzQsImV4cCI6MjEwNTUwNjA3NH0.GoSwLS_rd8vOEzd8L9Mn2u62joKitVFEOJuzHwjfFR0',

  // Club details, from badrgrappling.co.uk and the club's Instagram.
  CLUB: {
    name: 'Badr Grappling',
    motto: 'Faith & Resilience',
    email: 'badrgrappling@outlook.com',
    phone: '07415 777731',
    phoneHref: 'tel:+447415777731',
    whatsapp: 'https://wa.me/447415777731',
    instagram: 'https://www.instagram.com/badrgrappling/',
  },

  // Fallback used only if the branches table cannot be reached, so that the
  // header never renders empty. The database is always the source of truth.
  FALLBACK_BRANCH: { id: null, slug: 'london', name: 'London' },
};

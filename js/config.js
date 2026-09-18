/* Badr Grappling — runtime configuration.
 *
 * The Supabase anon key is a public, row-level-security-gated key. It is
 * meant to ship in the browser bundle. Nothing secret belongs in this file:
 * the service-role key, the Stripe secret key and the webhook signing secret
 * all live as environment variables on Cloudflare Pages. See README.md.
 */
export const CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',

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

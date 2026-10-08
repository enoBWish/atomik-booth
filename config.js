// ATOMIK booth settings -- the only file that needs editing per event / once the backend is deployed.
export const CONFIG = {
  // Google Apps Script web app URL (backend/SETUP.md, step 5). Empty = offline mode: entries queue on the
  // tablet and send as soon as this is filled in and the booth is online.
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbzHRRxe4xUmowt9fDXu5VEeUzaEYALtQMuGCepPrpgF-EXkUSy7dzdpTDAdAUygmp0X/exec',
  // must match BOOTH_KEY in backend/Code.gs (stops randoms on the internet posting junk to the Sheet)
  BOOTH_KEY: '0O3tPabifM5E_tpYBpfAkeK_-lBBPQ9k',
  BOOTH_ID: 'atomik-booth-1',          // shows in the Sheet -- name each tablet if there's ever more than one
  EVENT_NAME: '',                      // e.g. 'Lucky Lou Pop-Up 10/18' -- shows in the Sheet

  // ATOMIK's policy pages (the SMS consent box links to these). Fill in the real ones.
  TERMS_URL: 'https://example.com/terms',
  PRIVACY_URL: 'https://example.com/privacy',

  REQUIRE_PHONE: false,                // phone is optional (still required if they tick the text-message box)

  // consent wording -- saved word-for-word with each entry, so there's a record of exactly what was agreed to
  CONSENT_EMAIL: 'Keep me updated via email with weekly newsletters and sales.',
  CONSENT_SMS: 'I agree to receive automated text messages from ATOMIK at the number provided. Msg & data rates may apply. ' +
               'Msg frequency varies. Reply STOP to cancel or HELP for help. View Terms & Privacy.',

  DONE_SECONDS: 45,                    // how long the "scan your QR" screen stays up before resetting
};

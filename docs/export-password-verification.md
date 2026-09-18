# Export password verification

Issue [#195](https://github.com/danpicton/crapnote/issues/195) separates the optional archive secret from account credentials. The export control is its own `autocomplete="off"` form and uses the explicit `export-archive-password` name and ID; the account-password form and login form retain explicit account credential semantics.

## Automated verification

Tested with **Google Chrome for Testing 149.0.7827.55** through **Playwright 1.61.1** on Linux:

- password-protected and plain exports both download valid ZIP responses;
- encrypted ZIP entries carry the encryption flag (decryption with the supplied password is covered by `backend/internal/export/export_test.go`);
- the export secret is cleared after a successful download;
- login and account-password change flows still complete;
- the export and account-password controls have separate forms, accessible labels, IDs, and names, while login keeps `username` and `current-password` autofill tokens.

## Native password-manager check

The native save/update-password prompt and saved-credential autofill require a normal browser profile with password saving enabled. Playwright's isolated automated profile does not expose browser-chrome password-manager UI, so the Chrome run above cannot prove either native behavior. Before release, repeat the issue's reproduction steps in a normal Chrome profile that has Crapnote credentials saved and confirm that:

1. the saved account password does not fill the **Archive password (optional)** field;
2. exporting with a different archive password does not offer to save or update the Crapnote login;
3. the login form still offers/fills the saved Crapnote credentials; and
4. changing the account password still offers to update the saved Crapnote credential.

`autocomplete` is advisory. Other browser versions and third-party password managers may apply different heuristics, so this change does not claim to control all of them.

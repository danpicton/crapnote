# Export password verification

Issue [#195](https://github.com/danpicton/crapnote/issues/195) separates the optional archive secret from account credentials. The export control is its own `autocomplete="off"` form and uses the explicit `export-archive-secret` name and ID. Chrome still treated an HTML password input in that form as an account credential, so the control is a text input visually obscured with `-webkit-text-security`; the account-password and login forms retain real password inputs and explicit account credential semantics.

## Native browser verification

Tested with **Google Chrome 153.0.8010.52 stable** on Linux, using a fresh normal profile with password saving enabled. Chrome was driven through its visible native UI without Playwright or the DevTools protocol.

1. With the export control still using `type="password"` and `autocomplete="off"`, the issue was reproduced: exporting with `archive-secret-195` opened Chrome's native **Update password?** prompt for the saved `admin` account.
2. The login was saved through Chrome's native **Save password?** prompt. After closing and reopening Chrome, the saved username and account password autofilled on `/login` and successfully signed in.
3. On `/settings`, the saved account password did not autofill into **Archive password (optional)**. The field was empty and visually obscured entered text.
4. Exporting with `archive-secret-195` downloaded the archive, cleared the field, and did not show a save/update-password prompt during the download or in the following six seconds.
5. Changing the actual account password still succeeded and opened Chrome's intentional native **Update password?** prompt for `admin`.

This verifies both the original failure and the fix against Chrome's real password-manager UI in the same saved-credential profile.

## Automated verification

Also tested with **Google Chrome for Testing 149.0.7827.55** through **Playwright 1.61.1** on Linux:

- password-protected and plain exports both download valid ZIP responses;
- encrypted ZIP entries carry the encryption flag (decryption with the supplied password is covered by `backend/internal/export/export_test.go`);
- the export secret is cleared after a successful download;
- login and account-password change flows still complete;
- the export and account-password controls have separate forms, accessible labels, IDs, and names, while login keeps `username` and `current-password` autofill tokens.

## Remaining limitations

`autocomplete` and password-manager detection are browser-specific. The masked text control was verified in the Chrome version above, but other browser versions and third-party password managers may apply different heuristics. The visual masking uses the non-standard `-webkit-text-security` property supported by the verified Chrome version; this change does not promise control over every password manager.

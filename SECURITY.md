# Security Implementation Guide

This document outlines the security improvements made to scottfriedman.ooo and the steps required to complete the setup.

## Summary of Changes

### 1. Firebase Security Rules (`firebase.rules.json`)

Created comprehensive security rules that:
- **Content & Pages**: Public read, admin-only write (requires authentication)
- **Benefits cache**: Public read, authenticated workers only for writes
- **Sticky notes**: Public create with validation, admin-only delete
- **Drawing strokes**: Public with structure validation
- **Command center**: Admin-only configuration
- **Default deny**: All undefined paths are blocked

### 2. Admin Authentication (`admin.html`)

Replaced insecure client-side password with Firebase Authentication:
- Uses Firebase Auth email/password sign-in
- Verifies user is in `/admins/{uid}` list
- Proper sign-out functionality
- No more base64-encoded passwords in source code

### 3. XSS Prevention

Added HTML sanitization across the site:
- **`js/sanitize.js`**: Shared sanitization library
- **`main.js`**: Escapes all dynamic content (projects, writing, sounds, contact)
- **`page.html`**: Sanitizes custom page HTML content (allows safe tags only)
- **`benefits.html`**: Uses existing escapeHtml function

### 4. Worker Security Improvements

**Benefits Proxy (`worker/benefits-proxy.js`)**:
- Reduced rate limits (5/min, 30/hour per IP)
- Added daily budget cap (500 API calls)
- Production-only CORS (no localhost)
- Multi-tier rate limiting

**Home Assistant Proxy (`worker/ha-proxy.js`)**:
- Added rate limiting (20 controls/min per IP)
- Production-only CORS (no localhost)

---

## Required Setup Steps

### Step 1: Deploy Firebase Security Rules

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: `scottfriedman-f400d`
3. Navigate to **Realtime Database** → **Rules**
4. Copy contents of `firebase.rules.json` and paste into the rules editor
5. Click **Publish**

**Important**: Test the rules before publishing:
- Click "Rules Playground" to simulate requests
- Verify admin writes require authentication
- Verify public reads work for content

### Step 2: Enable Firebase Authentication

1. In Firebase Console, go to **Authentication** → **Sign-in method**
2. Enable **Email/Password** provider
3. Go to **Authentication** → **Users**
4. Click **Add user**
5. Enter your email and a strong password (16+ characters recommended)
6. Copy the **User UID** shown after creation

### Step 3: Add Yourself as Admin

1. Go to **Realtime Database**
2. Create a new entry at the root:
   ```
   admins/
     YOUR_USER_UID_HERE: true
   ```
3. Replace `YOUR_USER_UID_HERE` with the UID from Step 2

### Step 4: Deploy Updated Workers

```bash
# Deploy Benefits API proxy
cd worker
npx wrangler deploy --config wrangler-benefits.toml

# Deploy Home Assistant proxy
npx wrangler deploy
```

### Step 5: Rotate Credentials (Critical!)

Your previous credentials are exposed in git history. Generate new ones:

1. **Gemini API Key**:
   - Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Create a new API key
   - Update in Cloudflare: `npx wrangler secret put GEMINI_API_KEY --config wrangler-benefits.toml`

2. **Home Assistant Token**:
   - In Home Assistant, go to Profile → Long-Lived Access Tokens
   - Create a new token
   - Revoke the old token
   - Update in Cloudflare: `npx wrangler secret put HA_TOKEN`

### Step 6: Set Up Google Cloud Budget Alerts

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **Billing** → **Budgets & alerts**
3. Create a budget with alerts at $5, $10, $20
4. Enable email notifications

---

## What Each File Does

| File | Purpose |
|------|---------|
| `firebase.rules.json` | Database access control rules |
| `js/sanitize.js` | HTML sanitization to prevent XSS |
| `admin.html` | Admin panel with Firebase Auth |
| `worker/benefits-proxy.js` | Gemini API proxy with rate limiting |
| `worker/ha-proxy.js` | Home Assistant proxy with rate limiting |

---

## Security Best Practices

### For Ongoing Maintenance

1. **Never commit secrets** - Use `wrangler secret put` for API keys
2. **Review Firebase rules** periodically - Ensure they match your needs
3. **Monitor usage** - Check Firebase and Cloudflare dashboards regularly
4. **Keep dependencies updated** - Especially Firebase SDK versions

### Rate Limits Summary

| Endpoint | Limit |
|----------|-------|
| Benefits API | 5/min, 30/hour per IP |
| Daily API budget | 500 calls total |
| HA Control | 20/min per IP |

### Allowed HTML Tags (Sanitizer)

Safe tags allowed in custom pages:
- Headings: `h1-h6`
- Text: `p`, `br`, `hr`, `strong`, `b`, `em`, `i`, `u`, `s`
- Lists: `ul`, `ol`, `li`
- Links: `a` (with href validation)
- Images: `img` (with src validation)
- Code: `pre`, `code`, `blockquote`
- Tables: `table`, `thead`, `tbody`, `tr`, `th`, `td`
- Layout: `div`, `span`

Blocked:
- `script`, `iframe`, `object`, `embed`, `form`, `input`, `style`, `link`
- All event handlers (`onclick`, `onerror`, etc.)
- `javascript:` and `data:` URLs

---

## Testing Security

### Test Firebase Rules

```javascript
// Should work (public read)
fetch('https://scottfriedman-f400d-default-rtdb.firebaseio.com/content.json')

// Should fail (write without auth)
fetch('https://scottfriedman-f400d-default-rtdb.firebaseio.com/content.json', {
  method: 'PUT',
  body: JSON.stringify({test: 'should fail'})
})
```

### Test Rate Limiting

```bash
# Hit the benefits API repeatedly - should get 429 after 5 requests
for i in {1..10}; do
  curl -X POST https://benefits-api.s-friedman.workers.dev/api/benefits \
    -H "Content-Type: application/json" \
    -d '{"query":"test"}'
done
```

### Test XSS Prevention

Try adding this to a custom page content in admin:
```html
<script>alert('xss')</script>
<img src=x onerror="alert('xss')">
<a href="javascript:alert('xss')">click</a>
```

None of these should execute - scripts are stripped, event handlers removed, javascript: URLs blocked.

---

## Incident Response

If you suspect a breach:

1. **Immediately disable Command Center** in admin panel
2. **Rotate all credentials** (Gemini key, HA token)
3. **Review Firebase data** for unauthorized changes
4. **Check Cloudflare analytics** for unusual traffic patterns
5. **Review Git history** for any exposed secrets

---

## Questions?

If you have questions about these security measures, refer to:
- [Firebase Security Rules Documentation](https://firebase.google.com/docs/database/security)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)

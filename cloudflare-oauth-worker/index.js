// Decap CMS OAuth Proxy Worker Template
const PRODUCTION_ORIGINS = [
  'https://<your-domain>',
  'https://<your-github-username>.github.io'
];

const DEVELOPMENT_ORIGINS = [
  'http://localhost:4000',
  'http://localhost:3000',
  'http://127.0.0.1:4000'
];

function getAllowedOrigins(env) {
  if (env.ENVIRONMENT === 'development') {
    return [...PRODUCTION_ORIGINS, ...DEVELOPMENT_ORIGINS];
  }
  return PRODUCTION_ORIGINS;
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowedOrigins = getAllowedOrigins(env);
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : PRODUCTION_ORIGINS[0];
  
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request, env);
    const allowedOrigins = getAllowedOrigins(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/auth') {
      const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
      githubAuthUrl.searchParams.set('client_id', env.OAUTH_CLIENT_ID);
      githubAuthUrl.searchParams.set('scope', 'repo,user');
      return Response.redirect(githubAuthUrl.toString(), 302);
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      if (!code) {
        return new Response('Missing code parameter', { status: 400, headers: corsHeaders });
      }

      try {
        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Decap-CMS-Cloudflare-OAuth-Proxy'
          },
          body: JSON.stringify({
            client_id: env.OAUTH_CLIENT_ID,
            client_secret: env.OAUTH_CLIENT_SECRET,
            code
          })
        });

        const data = await response.json();

        if (data.error) {
          return new Response(`OAuth Error: ${data.error_description || data.error}`, { 
            status: 400, 
            headers: corsHeaders 
          });
        }

        const token = data.access_token;
        const provider = 'github';

        const html = `
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"><title>Authorizing...</title></head>
          <body>
          <script>
            (function() {
              const allowedOrigins = ${JSON.stringify(allowedOrigins)};
              function receiveMessage(e) {
                if (!allowedOrigins.includes(e.origin)) {
                  console.warn("Blocked unauthorized postMessage origin: " + e.origin);
                  return;
                }
                window.opener.postMessage(
                  'authorization:${provider}:success:${JSON.stringify({ token, provider })}',
                  e.origin
                );
              }
              window.addEventListener("message", receiveMessage, false);
              if (window.opener) {
                window.opener.postMessage("authorizing:${provider}", "*");
              }
            })();
          </script>
          </body>
          </html>
        `;

        return new Response(html, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/html;charset=UTF-8',
            'Content-Security-Policy': "default-src 'self' 'unsafe-inline'"
          }
        });
      } catch (err) {
        return new Response(`Server error: ${err.message}`, { status: 500, headers: corsHeaders });
      }
    }

    return new Response('Cloudflare Decap CMS OAuth Proxy is running securely.', { 
      status: 200, 
      headers: corsHeaders 
    });
  }
};

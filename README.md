# Acquah Travel

[![CI](https://github.com/acquahhh/Acquah-Travel-summative/actions/workflows/ci.yml/badge.svg)](https://github.com/acquahhh/Acquah-Travel-summative/actions/workflows/ci.yml)

Search, compare and book flights across Africa (Duffel test mode).

- **Live site (load balancer):** http://18.130.219.94
- **Demo video:** Link coming soon
- **Repository:** https://github.com/acquahhh/Acquah-Travel-summative

> **For graders:** no login is needed. Open the live site and search a route such as Kigali → Nairobi. The Duffel test token is provided in the submission comments. It is never stored in this repository.

Acquah Travel is a flight booking site for people travelling within East and West Africa: Kigali, Accra, Lagos, Nairobi, Addis Ababa, Johannesburg, Dar es Salaam, Entebbe and more. Booking regional flights often means checking several airline sites one by one. This project puts search, comparison and booking for these routes in one simple page.

> **Demo only.** The site uses the [Duffel Flights API](https://duffel.com/docs) in **test mode**. Results come from Duffel's sandbox airline, bookings are test orders paid from a test balance, and **no real tickets are issued and no money is taken.**

## Features

- Airport autocomplete for the From and To fields, a swap button, and one-click popular routes (Kigali → Nairobi, Accra → Lagos, …)
- One-way and return trips, 1–9 passengers, and economy, premium economy, business and first cabins
- Result cards showing airline, times, duration, stops, flight numbers, baggage and total price
- Filters for maximum stops, airline, departure time of day and maximum price; sorting by cheapest, fastest or earliest departure; a results count
- A "Prices refreshed X min ago" label, since offers expire
- Booking flow: the fare is re-checked with the airline, you fill in one form per passenger, review your details, then confirm. The confirmation shows the booking reference, route, passengers and total.
- My trips: look up a booking by reference or order ID. Bookings made in this browser are saved in localStorage.
- Loading, empty and error states, with a Retry button on errors
- Server-side validation and Helmet security headers
- Rate limiting on `/api`: 60 requests per minute per IP
- Caching (airports 24 h, searches 5 min, errors never cached) and a 10 s timeout on every Duffel call
- `GET /health` endpoint and an `X-Served-By` header on every response, for load-balancer checks

## Get a Duffel test token

1. Sign up at [app.duffel.com](https://app.duffel.com/join). It's free.
2. Turn on **Test mode** in the dashboard.
3. Go to **More → Developers → Access tokens** and create a token. Test tokens start with `duffel_test_`.
4. Put it in `.env` (see below). Never commit it.

## Run locally

Requires Node.js 20 or newer (it uses the built-in `fetch`).

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
                          # then paste your token into DUFFEL_TOKEN
npm run dev               # restarts on file changes; use `npm start` in production
```

Open http://localhost:3000. The console prints `Server running at http://localhost:3000`.

## Testing

```bash
npm test
```

This runs the unit tests in `validate.test.js` with Node's built-in test runner (`node --test`). They cover the server-side validation of flight searches and passenger details, and need no Duffel token or network access.

The [CI workflow](.github/workflows/ci.yml) runs the same tests with GitHub Actions on every push and pull request to `main`: it checks out the code, sets up Node 20 with npm caching, then runs `npm ci` and `npm test`. The badge at the top of this README shows the latest result.

## API

The browser only talks to this server. The Duffel token never leaves the server.

| Route | Purpose |
| --- | --- |
| `GET /api/airports?q=nair` | Airport suggestions `[{iata, name, city, country}]` |
| `POST /api/search` | `{from, to, depart, return?, adults, cabin}` → simplified offers |
| `GET /api/offers/:id` | Re-check one offer before booking |
| `POST /api/bookings` | `{offer_id, passengers[]}` → create an instant test order |
| `GET /api/bookings/:ref` | Look up an order by ID (`ord_…`) or booking reference |
| `GET /health` | `{status: "ok", server: <hostname>}` |

Errors always come back as `{ "error": "<code>", "message": "<readable text>" }`. Examples: `missing_token`, `invalid_input`, `offer_expired`, `timeout`, `duffel_error`, `rate_limited`.

## Deployment

The live site runs on three servers:

| Server | IP | Role |
| --- | --- | --- |
| `7231-web-01` | 13.40.173.98 | Nginx :80 → Node :3000 (systemd) |
| `7231-web-02` | 3.10.221.37 | Nginx :80 → Node :3000 (systemd) |
| `7231-lb-01` | 18.130.219.94 | HAProxy :80, round robin with a `GET /health` check |

```
                                     ┌── 7231-web-01: Nginx :80 → Node :3000
client → 7231-lb-01 (HAProxy :80) ───┤
                                     └── 7231-web-02: Nginx :80 → Node :3000
```

All three use the `ubuntu` user and are reached over SSH with a key:

```bash
ssh -i ~/.ssh/school ubuntu@13.40.173.98    # 7231-web-01
ssh -i ~/.ssh/school ubuntu@3.10.221.37     # 7231-web-02
ssh -i ~/.ssh/school ubuntu@18.130.219.94   # 7231-lb-01
```

Steps 1–3 are done on **both** web servers. Step 4 is done on the load balancer.

### 1. Install Node.js and the app (web-01 and web-02)

The ALU servers are minimal Ubuntu 20.04 (arm64) images. They don't include `nano` or a recent Node.js, so install Node 20 from NodeSource along with Nginx, Git and nano:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs nginx git nano
node -v                                                    # should print v20.x

sudo git clone https://github.com/acquahhh/Acquah-Travel-summative.git /opt/acquah-travel
sudo chown -R ubuntu:ubuntu /opt/acquah-travel
cd /opt/acquah-travel && npm ci --omit=dev
cp .env.example .env && nano .env                          # add DUFFEL_TOKEN
```

### 2. systemd service (web-01 and web-02)

Save this as `/etc/systemd/system/acquah-travel.service` (`sudo nano /etc/systemd/system/acquah-travel.service`):

```ini
[Unit]
Description=Acquah Travel flight booking site (Node.js)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/acquah-travel
EnvironmentFile=/opt/acquah-travel/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Then enable **and** start it, and check it answers locally:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now acquah-travel
sudo systemctl status acquah-travel
curl -s http://localhost:3000/health
```

### 3. Nginx (web-01 and web-02)

The servers come with an old default Nginx site that answers on port 80. Remove it first:

```bash
sudo rm /etc/nginx/sites-enabled/default
```

Then save this as `/etc/nginx/sites-available/acquah-travel` (`sudo nano /etc/nginx/sites-available/acquah-travel`):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}
```

Enable the site and reload Nginx:

```bash
sudo ln -sf /etc/nginx/sites-available/acquah-travel /etc/nginx/sites-enabled/acquah-travel
sudo nginx -t && sudo systemctl reload nginx
curl -s http://localhost/health
```

### 4. HAProxy (lb-01)

```bash
sudo apt-get update && sudo apt-get install -y haproxy nano
sudo nano /etc/haproxy/haproxy.cfg
```

Replace the file with:

```haproxy
global
    log /dev/log local0
    maxconn 2048
    user haproxy
    group haproxy
    daemon

defaults
    log     global
    mode    http
    option  httplog
    option  forwardfor
    timeout connect 5s
    timeout client  30s
    timeout server  30s

frontend acquah_front
    bind *:80
    default_backend acquah_web

backend acquah_web
    balance roundrobin
    option httpchk GET /health
    http-check expect status 200
    server 7231-web-01 13.40.173.98:80 check
    server 7231-web-02 3.10.221.37:80 check
```

Check the config and restart HAProxy:

```bash
sudo haproxy -c -f /etc/haproxy/haproxy.cfg && sudo systemctl restart haproxy
```

HAProxy sends requests to the two web servers in turn (`balance roundrobin`). It calls `GET /health` on each server and stops sending traffic to a server that fails the check.

Because traffic goes through HAProxy and then Nginx, the app trusts two proxy hops (`trust proxy = 2`). This lets rate limiting see the real client IP.

### 5. Testing the load balancer

Every response carries an `X-Served-By` header, and `/health` returns the hostname of the server that handled it. Check the header with:

```bash
curl -I http://18.130.219.94/
```

To watch round robin at work, call `/health` six times.

Linux / macOS:

```bash
for i in $(seq 6); do curl -s http://18.130.219.94/health; echo; done
```

Windows PowerShell:

```powershell
1..6 | % { (Invoke-WebRequest -UseBasicParsing http://18.130.219.94/health).Content }
```

Real output from the live servers:

```
{"status":"ok","server":"7231-web-01"}
{"status":"ok","server":"7231-web-02"}
{"status":"ok","server":"7231-web-01"}
{"status":"ok","server":"7231-web-02"}
{"status":"ok","server":"7231-web-01"}
{"status":"ok","server":"7231-web-02"}
```

**Why the footer may not change when you refresh:** the footer shows "Served by <hostname>" from the latest API response. A fresh page load sends an even number of requests through the load balancer (the page, stylesheet, two scripts, favicon and the `/health` call). With round robin, the footer's `/health` call keeps landing on the same server. Run several searches and the footer changes, because each search is one extra request that moves the rotation along.

**Failover test:** stop the app on one web server and keep using the site:

```bash
# on 7231-web-02
sudo systemctl stop acquah-travel
```

Within a few seconds HAProxy marks `7231-web-02` as down. The site keeps working, and every response now comes from `7231-web-01`. Start the service again with `sudo systemctl start acquah-travel` and the rotation returns.

## API credits

- [Duffel Flights API](https://duffel.com/docs): flight search, offers and orders
  - [Places suggestions](https://duffel.com/docs/api/v2/places)
  - [Offer requests](https://duffel.com/docs/api/v2/offer-requests)
  - [Offers](https://duffel.com/docs/api/v2/offers)
  - [Orders](https://duffel.com/docs/api/v2/orders)
  - [Test mode](https://duffel.com/docs/guides/getting-started-with-flights)
- Airline logos come from Duffel's asset CDN.

Acquah Travel is a fictional travel agency. It is not affiliated with any airline.

## Challenges

**SSH "Permission denied (publickey)".** Connecting to the servers failed until I pointed SSH at the right private key. The fix was to pass it explicitly with `-i`: `ssh -i ~/.ssh/school ubuntu@<ip>`.

**nano missing on the server image.** The ALU servers are minimal Ubuntu 20.04 (arm64) images, so `nano` wasn't there to edit `.env` and the config files. I added it to the install command, together with Node 20 from NodeSource, Nginx and Git (step 1 above).

**Old default Nginx site still answering.** After setting up the app, the web servers still returned the ALU default page ("Holberton School for the win!"), because `/etc/nginx/sites-enabled/default` was still enabled and caught requests on port 80. Removing it with `sudo rm /etc/nginx/sites-enabled/default`, enabling the `acquah-travel` site, then `sudo nginx -t && sudo systemctl reload nginx` fixed it.

**502 Bad Gateway on web-02.** Nginx on web-02 returned 502 because nothing was listening on port 3000. The systemd unit file had been created but never enabled or started. `sudo systemctl daemon-reload && sudo systemctl enable --now acquah-travel` fixed it. I then checked it with `systemctl status acquah-travel` and `curl -s http://localhost:3000/health` before testing through the load balancer.

**The footer seemed not to switch servers.** Refreshing the page kept showing the same server, which looked like the load balancer wasn't working. Each page load sends an even number of requests, so with round robin the footer's `/health` call kept landing on the same server. Calling `/health` in a loop with curl showed the servers alternating correctly, and running a few searches made the footer change too (see "Testing the load balancer").

**Limited sandbox results for African routes.** Duffel's test mode returns offers from its sandbox airline, and some African routes and dates return few or no flights. The site handles this with a clear empty state ("No flights found, try other dates or a nearby airport.") instead of an error. The popular-route buttons give a quick way to try other routes.

**Keeping files small while reducing their number.** The project rules ask for few files and short files at the same time. I merged the frontend helpers and results code into `public/app.js` and the deploy configs into this README. Duplicated helpers were removed so every file stays under its line limit. Validation was kept in its own `validate.js` so it can be unit-tested without starting the server.

## AI assistance

Used claude to help me generate the readme file and also helped me in integrating the them on the servers


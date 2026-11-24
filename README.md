# Acquah Travel

Search, compare and book flights across Africa (Duffel test mode).

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
- Server-side validation, Helmet security headers, rate limiting on `/api`, caching (airports 24 h, searches 5 min, errors never cached) and a 10 s timeout on every Duffel call
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
cp .env.example .env      # then paste your token into DUFFEL_TOKEN
npm run dev               # restarts on file changes; use `npm start` in production
```

Open http://localhost:3000. The console prints `Server running at http://localhost:3000`.

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

## Deployment (Web01, Web02 + Lb01)

```
             ┌──────────── Web01: Nginx :80 → Node :3000 (systemd)
client → Lb01 (HAProxy, roundrobin, GET /health)
             └──────────── Web02: Nginx :80 → Node :3000 (systemd)
```

### 1. Install the app on Web01 and Web02 (Ubuntu)

```bash
sudo apt update && sudo apt install -y nginx nodejs npm   # Node 20+ (NodeSource if the distro's is older)
sudo git clone <your-repo-url> /opt/acquah-travel
sudo chown -R ubuntu:ubuntu /opt/acquah-travel
cd /opt/acquah-travel && npm ci --omit=dev
cp .env.example .env && nano .env                          # add DUFFEL_TOKEN
```

### 2. systemd service on Web01 and Web02

Save this as `/etc/systemd/system/acquah-travel.service` (`sudo nano /etc/systemd/system/acquah-travel.service`). Change `User=` if your server account is not `ubuntu`.

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

Then enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now acquah-travel
sudo systemctl status acquah-travel
curl -s http://localhost:3000/health
```

### 3. Nginx on Web01 and Web02

Save this as `/etc/nginx/sites-available/acquah-travel`:

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

Then enable the site and reload Nginx:

```bash
sudo ln -sf /etc/nginx/sites-available/acquah-travel /etc/nginx/sites-enabled/acquah-travel
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 4. HAProxy on Lb01

```bash
sudo apt install -y haproxy
sudo nano /etc/haproxy/haproxy.cfg
```

Replace the file with the following, and swap `WEB01_IP` and `WEB02_IP` for your servers' addresses:

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
    server web01 WEB01_IP:80 check
    server web02 WEB02_IP:80 check
```

Then check the config and restart HAProxy:

```bash
sudo haproxy -c -f /etc/haproxy/haproxy.cfg && sudo systemctl restart haproxy
```

HAProxy sends requests to Web01 and Web02 in turn (`balance roundrobin`). It calls `GET /health` on each server and stops sending traffic to a server that fails the check.

### 5. Testing the load balancer

Each response carries an `X-Served-By` header with the hostname of the server that handled it. Run this a few times against Lb01 and the value should alternate:

```bash
curl -I http://LB01_IP/
# HTTP/1.1 200 OK
# X-Served-By: web-01
curl -I http://LB01_IP/
# X-Served-By: web-02
curl http://LB01_IP/health
# {"status":"ok","server":"web-02"}
```

The site footer also shows "Served by <hostname>". If you stop the app on one server (`sudo systemctl stop acquah-travel`), HAProxy marks it down and all requests go to the other.

Because traffic goes through HAProxy and then Nginx, the app trusts two proxy hops (`trust proxy = 2`). This lets rate limiting see the real client IP.

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

_To be filled in._

## AI assistance

_To be filled in._

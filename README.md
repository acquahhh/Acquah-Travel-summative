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

### Web01 and Web02 (Ubuntu)

```bash
sudo apt update && sudo apt install -y nginx nodejs npm   # Node 20+ (NodeSource if the distro's is older)
sudo mkdir -p /var/www && sudo chown $USER /var/www
git clone <your-repo-url> /var/www/acquah-travel
cd /var/www/acquah-travel && npm ci --omit=dev
cp .env.example .env && nano .env                          # add DUFFEL_TOKEN

sudo cp deploy/nyota.service /etc/systemd/system/nyota.service
sudo systemctl daemon-reload && sudo systemctl enable --now nyota
sudo systemctl status nyota

sudo cp deploy/nginx.conf /etc/nginx/sites-available/acquah-travel
sudo ln -sf /etc/nginx/sites-available/acquah-travel /etc/nginx/sites-enabled/acquah-travel
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Change `User=` in `nyota.service` if your server account is not `ubuntu`.

### Lb01 (HAProxy)

```bash
sudo apt install -y haproxy
sudo cp deploy/haproxy.cfg /etc/haproxy/haproxy.cfg   # replace WEB01_IP / WEB02_IP
sudo haproxy -c -f /etc/haproxy/haproxy.cfg && sudo systemctl restart haproxy
```

HAProxy sends requests to Web01 and Web02 in turn (`balance roundrobin`). It calls `GET /health` on each server and stops sending traffic to a server that fails the check.

### Testing the load balancer

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

The site footer also shows "Served by <hostname>". If you stop the app on one server (`sudo systemctl stop nyota`), HAProxy marks it down and all requests go to the other.

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

const express = require("express");
const app = express();
const { resolve } = require("path");
// Copy the .env.example in the root into a .env file in this folder
const env = require("dotenv").config({ path: "./.env" });
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
app.use(express.static(process.env.STATIC_DIR));
app.use(
  express.json({
    // We need the raw body to verify webhook signatures.
    // Let's compute it only when hitting the Stripe webhook endpoint.
    verify: function(req, res, buf) {
      if (req.originalUrl.startsWith("/webhook")) {
        req.rawBody = buf.toString();
      }
    }
  })
);

app.get("/", (req, res) => {
  const path = resolve(process.env.STATIC_DIR + "/index.html");
  res.sendFile(path);
});
// Fetch the Checkout Session to display the JSON result on the success page
app.get("/checkout-session", async (req, res) => {
  const { sessionId } = req.query;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  res.send(session);
});

app.post("/create-checkout-session", async (req, res) => {
  const planId = process.env.SUBSCRIPTION_PLAN_ID;
  const domainURL = process.env.DOMAIN;

  let session;
  const { isBuyingSticker } = req.body;
  if (isBuyingSticker) {
    // Customer is signing up for a subscription and purchasing the extra e-book
    session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          name: "Pasha e-book",
          quantity: 1,
          currency: "usd",
          amount: 300
        }
      ],
      subscription_data: {
        items: [
          {
            plan: planId
          }
        ]
      },
      success_url: `${domainURL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${domainURL}/cancel.html`
    });
  } else {
    // Customer is only signing up for a subscription
    session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      subscription_data: {
        items: [
          {
            plan: planId
          }
        ]
      },
      success_url: `${domainURL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${domainURL}/cancel.html`
    });
  }

  res.send({
    checkoutSessionId: session.id
  });
});

app.get("/public-key", (req, res) => {
  res.send({
    publicKey: process.env.STRIPE_PUBLISHABLE_KEY
  });
});

// Webhook handler for asynchronous events.
app.post("/webhook", async (req, res) => {
  let data;
  let eventType;
  // Check if webhook signing is configured.
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    // Retrieve the event by verifying the signature using the raw body and secret.
    let event;
    let signature = req.headers["stripe-signature"];

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log(`⚠️  Webhook signature verification failed.`);
      return res.sendStatus(400);
    }
    // Extract the object from the event.
    data = event.data;
    eventType = event.type;
  } else {
    // Webhook signing is recommended, but if the secret is not configured in `config.js`,
    // retrieve the event data directly from the request body.
    data = req.body.data;
    eventType = req.body.type;
  }

  if (eventType === "checkout.session.completed") {
    const items = data.object.display_items;
    const customer = await stripe.customers.retrieve(data.object.customer);

    if (
      items.length &&
      items[0].custom &&
      items[0].custom.name === "Pasha e-book"
    ) {
      console.log(
        `🔔  Customer is subscribed and bought an e-book! Send the e-book to ${customer.email}.`
      );
    } else {
      console.log(`🔔  Customer is subscribed but did not buy an e-book.`);
    }
  }

  res.sendStatus(200);
});

app.listen(4242, () => console.log(`Node server listening on port ${4242}!`));

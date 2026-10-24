// Envoi d'un message WhatsApp au propriétaire du salon.
// Fournisseur choisi par WHATSAPP_PROVIDER : "callmebot" (gratuit), "twilio", ou vide (message affiché dans la console).

async function viaCallMeBot(to, text) {
  const key = process.env.CALLMEBOT_APIKEY;
  if (!key) throw new Error('CALLMEBOT_APIKEY manquant');
  const url = 'https://api.callmebot.com/whatsapp.php?' + new URLSearchParams({ phone: to, text, apikey: key });
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok || /error|invalid/i.test(body)) throw new Error(`CallMeBot ${res.status} : ${body.replace(/<[^>]+>/g, ' ').trim().slice(0, 200)}`);
}

async function viaTwilio(to, text) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = process.env;
  if (!sid || !token || !from) throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN ou TWILIO_FROM manquant');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
    body: new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:${to}`, Body: text }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status} : ${(await res.text()).slice(0, 200)}`);
}

async function notifyOwner(text) {
  const to = process.env.OWNER_WHATSAPP;
  const provider = (process.env.WHATSAPP_PROVIDER || '').toLowerCase();

  if (!provider) {
    console.log('--- WhatsApp (aucun fournisseur configuré) ---\n' + text);
    return;
  }
  if (!to) throw new Error('OWNER_WHATSAPP manquant');
  if (provider === 'callmebot') return viaCallMeBot(to, text);
  if (provider === 'twilio') return viaTwilio(to, text);
  throw new Error(`Fournisseur WhatsApp inconnu : ${provider}`);
}

module.exports = { notifyOwner };

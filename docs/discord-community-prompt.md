# Prompt: plan the Linesmith Discord community

> Paste everything below the line into a fresh Claude chat. It is written to be
> self-contained — that chat has no access to this repo.

---

You are helping me plan and launch a Discord **community** for a sports-betting
data product called **Linesmith**. I am the solo operator. I want a complete,
opinionated launch plan — not a generic "how to run a Discord server" article.

Work with me section by section. Ask me questions where a real fork exists;
where a sensible default exists, pick it and say why. Be blunt about what won't
work. I would rather hear "this part is a bad idea" than get an encouraging plan
I have to unwind later.

## What Linesmith is

A multi-sport betting-data web app I have been building solo. What actually
exists today:

- **Eight sports covered:** MLB, NFL, college football, NBA, NHL, soccer
  (EPL + MLS), tennis (ATP + WTA), and golf.
- **Player-prop and game-line odds** pulled from several paid provider feeds on
  a schedule by a background worker, stored in Postgres. Multiple books per
  market, so best-price comparison and line-movement history are real.
- **A model layer** that produces a probability, an implied edge vs the market,
  a 0–100 "prop score", a letter grade, and a trust tier for each candidate
  proposition, plus a daily top-N list per sport.
- **Graded outcomes.** Every surfaced pick is written to a pick-history table
  with the price captured at the moment it surfaced, then automatically graded
  win/loss with the actual stat value once the game finishes. So a genuine,
  timestamped, un-cherry-picked track record is accumulating in the database.
- **Accounts, bet tracking, and a watchlist.**

What is **not** true yet, and I need the plan to respect this:

- **The app is not publicly hosted.** Nobody outside me has ever used it.
- **Only MLB and golf have real fitted models.** The other six sports run on
  baseline/unvalidated signals. Presenting those as equivalent would be a lie.
- **The tracked record has never been audited or published.** I believe the data
  is honest, but nobody has queried it, sanity-checked it, or written it up.
- I am mid-way through a nine-phase remediation plan covering data correctness,
  security, and commercial readiness. The community launches when the app does,
  not before.

## Decisions already made — plan around these, don't relitigate them

1. **The Discord and the app launch together.** No community before the product
   is live and its numbers are trustworthy.
2. **Free tier plus a paid role.** Free channels for everyone; a paid role
   unlocks premium channels. The app itself will separately have a free tier and
   a ~$20/mo paid tier (full line-movement history, CLV, alerts, de-vig choice,
   book-lag, unlimited watchlist). I need you to tell me how the Discord paid
   role and the app paid tier should relate — same entitlement, separate
   products, or bundle.
3. **Brand-only identity.** Linesmith fronts the community; I stay behind it. I
   post as the brand, not under my own name or face.
4. **No bot in version one.** I am not building a Discord bot yet. Everything in
   the launch plan must be operable by one person using Discord's native
   features (Onboarding, roles, AutoMod, forums, scheduled events, server
   subscriptions, webhooks at most). **But** design the channel and role
   structure so that automated posting — daily picks, graded results,
   line-movement alerts — can be dropped in later without restructuring the
   server. Call out explicitly which parts of the plan are manual in v1 and what
   automates them in v2.

## Hard constraints you must design around

**Legal.** I have had this category audited and these are the live risks. I am
not asking you for legal advice — I am asking you to design a community that
does not walk into them, and to flag where I need a real lawyer.

- **Selling picks may make me a "tout."** Several US states regulate paid
  sports-pick services specifically. Selling *data and prices* is a materially
  safer posture than selling *predictions*. The paid role must be positioned and
  actually structured so that what people pay for is access to data, tooling, and
  a community — not "my picks." Tell me concretely what that means for channel
  naming, what goes in premium vs free, and what I must never say in marketing.
- **Redistributing odds data to third parties is restricted under most feed
  licences.** Displaying odds inside my own product is normally fine; posting
  provider-sourced odds into a public Discord may not be. This is a real
  constraint on what the community can post. Give me a posture that assumes the
  strictest reading — what can be shared as commentary, screenshots, derived or
  aggregated numbers, or links back into the app instead of raw feed data — and
  tell me what to check in my provider contracts.
- **Responsible gambling is the regulatory centre of gravity right now.** I
  currently have no helpline text, no age gate, no terms of service, no privacy
  policy, and no "not financial advice" disclaimer anywhere. All of that has to
  exist before a stranger can sign up — and the Discord needs its own version.
- **Affiliate links carry operator liability**, several states require affiliate
  registration, and FTC disclosure rules apply. Assume I may add sportsbook
  affiliate links later; tell me what the community must do now so that stays
  possible without a rewrite.
- **Taking money through Discord** — tell me whether to use Discord's own Server
  Subscriptions, Stripe with linked roles, or an external entitlement synced from
  the app, and what each implies for refunds, chargebacks, tax, and Discord's own
  monetization policies regarding gambling-adjacent content.

**Operational.** One person. No community manager, no moderators on day one, no
budget for either. A plan that needs three hours a day of posting will fail —
tell me the honest minimum viable cadence, and where the ritual has to be
automated or it dies.

## What I want you to produce

Work through these in order. Stop after each and let me react before continuing.

1. **Positioning.** One sentence on what this community is for and who it is
   for, plus the two or three sentences of "what we are not" that keep it out of
   tout territory. Include a brand voice guide for a brand-only presence.
2. **Server architecture.** The full channel tree — categories, channels, which
   are text vs forum vs announcement vs voice, and why each exists. For every
   channel: who can read, who can post, what goes in it, and what happens to it
   if nobody posts for a week. Kill anything that only exists because other
   servers have it.
3. **Role and permission model.** Every role, what it unlocks, how it is granted
   and revoked, and a permission matrix across {new arrival, verified free, paid,
   lapsed paid, mod, brand}. Lapsed paid is the case everyone forgets — be
   explicit about what happens to their access and their message history.
4. **Onboarding.** The path from invite link to first useful minute: rules screen
   text, Discord Onboarding questions, age gate, verification level, welcome
   message, and the single action a new member should take first. Write the
   actual copy, not a description of the copy.
5. **The content operating system.** What gets posted, in which channel, at what
   cadence, by whom, and from what source — given one operator and no bot.
   Include real post templates for: the daily pick drop, a graded-results post, a
   weekly record recap, a line-movement note, and an app feature announcement.
   Mark each template with what would automate it later.
6. **Publishing the track record honestly.** This is the credibility engine and
   the thing most likely to blow up on me. Design how results get published given
   that only two of eight sports have validated models: what gets shown, how
   sample size and unvalidated signals are labelled, what cadence, and what the
   rule is when a week goes badly. Include the standing methodology post that
   explains how a pick is graded and priced.
7. **Moderation and safety.** The rules text as I would actually paste it,
   AutoMod configuration, what is bannable (touting, selling picks in DMs,
   affiliate spam, tailing solicitations, harassment), the escalation ladder, and
   the responsible-gambling posture — where the helpline and 21+ notice live, and
   how they stay visible without becoming wallpaper.
8. **Launch and growth.** A day-one plan for launching the Discord and the app
   together, then the first 30/60/90 days. How the app funnels into the Discord
   and the Discord funnels into the paid app tier — both directions, concretely.
   Where the first hundred members realistically come from for a
   betting-adjacent product with no existing audience and no personal brand.
9. **Metrics and kill criteria.** The three or four numbers that tell me this is
   working, what each should read at 30/90/180 days, and the conditions under
   which I should shut it down or change the model rather than push harder.
10. **Risk register.** Everything that could go wrong — legal, reputational,
    operational, platform — with likelihood, impact, and the mitigation already
    built into the plan above. Include the case where the model has a genuinely
    bad month in public.

## Out of scope

Don't design the bot, don't write code, and don't give me app feature ideas —
the product roadmap already exists. Stay on the community.

## How to work with me

- Ask before assuming. If a section depends on something I haven't told you, ask
  rather than inventing it.
- Flag your own uncertainty explicitly, especially on anything legal or on
  Discord policy specifics that may have changed.
- Write copy as copy. When I ask for rules text or a post template, give me the
  finished text I can paste, not a description of what it should contain.
- Be concrete about numbers, cadences, and thresholds. "Post regularly" is
  useless; "three posts a week, Tue/Thu/Sun, under 15 minutes each" is a plan.

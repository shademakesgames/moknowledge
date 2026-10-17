# MoKnowledge

MoKnowledge takes a business website and turns it into an editable knowledge base. You put in a URL, it reads the site, and it fills in fields like company name, overview, people, offerings, legal policies, and social links. Every value keeps the page it came from, so you can check it before you use it.

I built it so the knowledge base could feed MoSocial, MoMail, and MoBlogs. A tool that writes for a business does a lot better when it has more than the homepage to work from.

## Run it locally

You need Node 22.19 or newer.

    npm install
    npm run dev

Then open http://localhost:3000 and paste in a website.

Other scripts:

    npm test          runs the scraper tests
    npm run typecheck checks the TypeScript
    npm run build     makes a production build

## How the scraper works

The crawler starts at the homepage and follows links two steps out. It stops at 40 pages, so a crawl stays bounded and doesn't run for ages. Team, firm, service, and legal pages get read first. Blog posts come last, since a blog can fill the whole page limit by itself.

It checks robots.txt before every request and won't fetch private or internal addresses. It also looks at sitemaps and the common platform feeds (Shopify, WordPress, WooCommerce, and Squarespace), because some pages only show up there.

Some sites build their content with JavaScript, so the homepage comes back almost empty. For those pages the crawler can open the page in headless Chromium. To turn that on, install Chromium and set the path:

    CHROMIUM_PATH=/usr/bin/chromium npm run dev

If you don't set it, the crawler still works. It just skips the rendering step.

## What goes in the knowledge base

Most of the fields are the basics: company name, overview, industry, year founded, address, phones, emails, and social links. I also added a few sections on purpose:

- Legal and compliance. Privacy policy, terms, disclaimers, and licenses. Marketing that contradicts the company's own policies is a real problem, so I wanted these in one place.
- People. Names, titles, and roles from bio pages and from the text on the page.
- Offerings. Products, services, and menu items, with prices and images where the site has them.
- Competitors. This one is manual for now. You enter a company and its website, and MoFlo Cloud can use it later.

Each field has a status: extracted, inferred, or unknown. Extracted means the page states it directly. Inferred means I worked it out from the page. Unknown means nothing was found. Each field also has a reviewed tag, so you can keep track of what you've already checked.

## Using the library

The library has card and table views. The details page has a fields view, which shows what's missing, and an expanded view, which reads like a document you can copy and paste from.

## Known limits

The scraper is still the weakest part. Some sites don't give up their information no matter what, and some values land in the wrong field. A few phrases on marketing pages look like names, so check people entries before you use them.

Fields that come back empty are just editable. An LLM or a short question list to the user after the crawl would fill most of those gaps, and I'd like to add that next.

The example in `examples/account-it.json` was made from an older crawl, so it doesn't show the newest fields.

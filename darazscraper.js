const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');
const BASE_URL = "https://www.daraz.com.np";
const NAV_TIMEOUT = 60000;

const CATEGORY_LINK_SELECTOR_GUESSES = [
    '#js_categories .card-categories-ul .card-categories-li'
];

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}


function jitter(ms, spreadMs = 500) {
    return ms + Math.floor(Math.random() * spreadMs);
}


async function extractCategories(page) {

    await page.waitForSelector("#js_categories", { timeout: 15000 });
    const linkNodes = await page.$$(CATEGORY_LINK_SELECTOR_GUESSES.join(','));
    if (!linkNodes.length) {
        console.warn('No category links found');
    }

    const cats = [];
    for (const link of linkNodes) {
        await sleep(jitter(100, 300));
        const parent = link;

        const name = await parent.evaluate(node => node.innerText);

        const url = await parent.evaluate((node) => node.getAttribute('href'));
        let fullUrlhttps = url.startsWith('//') ? 'https:' + url : url;
        const fullUrl = fullUrlhttps ? new URL(fullUrlhttps).href : null;

        if (fullUrl) {
            cats.push({ name: name, url: fullUrl });
        }

    }
    return cats;
}

async function extractProductsOnPage(page) {
    const have = await page.$$('.Bm3ON');
    if (have.length) {
        const items = await page.$$eval('.Bm3ON', (cards) => {
            console.log('step 1')
            return cards.map(card => {
                console.log('step 2')
                const title = card.querySelector('.buTCk .RfADt a')
                const price = card.querySelector('.buTCk .aBrP0 span')
                if (title) {
                    title_text = title ? title.innerText : '';
                }

                if (price) {
                    total_price = price ? price.innerText : '';
                }
                return { title: title_text, price: total_price };
            });
        });
        return items;
    }
    return [];
}


async function clickNextIfExists(page) {
    const nxtBtnNode = await page.$('li.ant-pagination-next');
    if (!nxtBtnNode) {
        return false;
    }
    const checkDisabled = await nxtBtnNode.evaluate(node => node.getAttribute('aria-disabled'));
    console.log(checkDisabled, 'checkdisaled');

    if (!checkDisabled) return false;
    const beforeURL = page.url();
    await Promise.allSettled([
        nxtBtnNode.click({ delay: 10 }),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 })
    ]);
    if (page.url() !== beforeURL) return true;

    return false;
}


async function scrapeCategory(page, category) {
    const products = [];

    await page.goto(category.url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });

    let pageIndex = 1;
    while (true) {
        console.log('running for time', pageIndex);
        const batch = await extractProductsOnPage(page);
        await sleep(jitter(3000, 2000));
        products.push(...batch);
        const progressed = await clickNextIfExists(page);
        await sleep(jitter(3000, 1000));
        console.log(progressed, 'next page raicha ta');
        if (!progressed) break;
        pageIndex++;
        if (pageIndex > 5) {
            console.warn(`Stopped at 2 pages for category: ${category.name}`);
            break;
        }
    }

    return products;
}


async function main() {

    let catIndex = 1;
    const browser = await puppeteer.launch({ headless: true })
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    try {
        await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
        const categories = await extractCategories(page);
        await sleep(jitter(2000, 2000));
        console.log(`Found ${categories.length} categories`);

        for (const singleCat of categories) {
            const products = await scrapeCategory(page, singleCat);
            console.log(singleCat.name + 'contains' + products.length + 'products');
            await sleep(jitter(4000, 2000));
            fs.writeFileSync(
                `${singleCat.name.replace(/\s+/g, '_')}.json`,   // file name per category
                JSON.stringify(products, null, 2),               // pretty JSON
                'utf-8'
            );
            catIndex++;

            if (catIndex > 2) {
                break;
            }
        }

    } catch (err) {
        console.error('SCRAPE_ERROR:', err);
    } finally {
        await browser.close();
    }
}

main();
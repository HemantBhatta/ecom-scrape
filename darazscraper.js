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
                const productURLNode = card.querySelector('a')
                const productURL = productURLNode.getAttribute('href');
                console.log(productURL, 'product_url')
                return { 'product_url': productURL };
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

        await sleep(jitter(6000, 2000));
        products.push(...batch);
        const progressed = await clickNextIfExists(page);
        await sleep(jitter(5000, 1000));
        console.log(progressed, 'next page raicha ta');
        if (!progressed) break;
        pageIndex++;

        if (pageIndex % 10 === 0) {
            await sleep(jitter(50000, 30000));
        }

        if (pageIndex > 5) {
            break;
        }
    }
    // console.log(products, 'products')
    return products;
}


async function getProductDetails(page, singleProductUrl) {
    const singleProductURL = new URL(singleProductUrl.product_url, BASE_URL).href;
    await page.goto(singleProductURL, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
    const parentCont = await page.waitForSelector(".pdp-block__product-detail", { timeout: 15000 });
    await parentCont.waitForSelector(".pdp-price_type_normal", { timeout: 30000, visible: true }).catch(() => { });;
    await parentCont.waitForSelector(".pdp-price_type_deleted", { timeout: 30000, visible: true }).catch(() => { });;
    const singleProductDetails = await parentCont.evaluate((parentElem) => {
        const productTitleElem = parentElem.querySelector('.pdp-mod-product-badge-title')
        const productDiscountPriceElem = parentElem.querySelector('.pdp-price_type_normal')
        const productOriginalPriceElem = parentElem.querySelector('.pdp-price_type_deleted')
        const productDiscountPercentElem = parentElem.querySelector('.pdp-product-price__discount')
        const productTitle = productTitleElem?.innerText || null;
        const productDiscountPrice = productDiscountPriceElem?.innerText || null;
        const productOriginalPrice = productOriginalPriceElem?.innerText || null;
        const productDiscountPercent = productDiscountPercentElem?.innerText || null;

        return { productTitle, productDiscountPrice, productOriginalPrice, productDiscountPercent };
    }, '.pdp-block__product-detail')

    return singleProductDetails;
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
        await sleep(jitter(3000, 2000));
        console.log(`Found ${categories.length} categories`);

        for (const singleCat of categories) {
            const categoriesProduct = [];
            console.log('Started to scrape ' + singleCat.name + ' category.');
            await sleep(jitter(8000, 2000));
            const products = await scrapeCategory(page, singleCat);
            console.log(singleCat.name + ' contains ' + products.length + ' products.');
            let productIndex = 1
            for (const singleProductURL of products) {
                const productDetails = await getProductDetails(page, singleProductURL);
                categoriesProduct.push(productDetails)
                productIndex++
                console.log('getting product details for product' + productIndex)
            }

            fs.writeFileSync(
                `${singleCat.name.replace(/\s+/g, '_')}.json`,   // file name per category
                JSON.stringify(categoriesProduct, null, 2),               // pretty JSON
                'utf-8'
            );
            catIndex++;
        }

    } catch (err) {
        console.error('SCRAPE_ERROR:', err);
    } finally {
        await browser.close();
    }
}

main();
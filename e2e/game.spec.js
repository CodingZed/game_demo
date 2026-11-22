import { test, expect } from '@playwright/test';

const state = page => page.evaluate(() => document.querySelector('#scene canvas').getGameState());
async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#scene canvas')).toBeVisible();
}

test('inspect all aircraft, zoom, and manually fly straight after releasing controls', async ({ page }) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await ready(page);
  for(const [id,name,wheels] of [['737','波音 737',6],['747','波音 747',18],['a380','空客 A380',22]]){
    await page.locator(`[data-id="${id}"]`).click();
    await expect(page.locator('#selected-name')).toContainText(name);
    expect((await state(page)).wheelCount).toBe(wheels);
    expect((await state(page)).gearDown).toBe(true);
  }
  for(const view of ['front','side','top']){
    await page.locator(`#view-${view}`).click();
    await expect(page.locator(`#view-${view}`)).toHaveAttribute('aria-pressed','true');
  }
  expect((await state(page)).rotation[0]).toBe(1.1);
  await page.locator('#zoom-reset').click();
  await page.locator('#zoom-in').click();await page.locator('#zoom-in').click();
  expect((await state(page)).zoom).toBeGreaterThan(1.5);
  await page.screenshot({path:'/tmp/little-sky-model-detail.png'});
  await page.locator('#zoom-reset').click();expect((await state(page)).zoom).toBe(1);
  await page.mouse.move(700,440);await page.mouse.wheel(0,-250);
  await expect.poll(async()=>(await state(page)).zoom).toBeGreaterThan(1);
  await page.locator('#zoom-reset').click();
  await page.mouse.move(620,440);await page.mouse.down();await page.mouse.move(700,470);await page.mouse.up();
  expect((await state(page)).rotation[1]).not.toBe(-.2);
  await page.locator('#zoom-reset').click();
  await page.screenshot({path:'/tmp/little-sky-desktop.png'});
  await page.locator('#start-button').click();
  expect((await state(page)).gearDown).toBe(false);
  expect((await state(page)).wheelCount).toBe(0);
  await expect.poll(async()=>(await state(page)).elapsed,{timeout:15000}).toBeGreaterThan(2);
  expect((await state(page)).position.slice(0,2)).toEqual([0,3]);
  await expect.poll(async()=>(await state(page)).score,{timeout:20000}).toBeGreaterThan(0);
  await page.keyboard.down('ArrowRight');
  await expect.poll(async()=>(await state(page)).position[0]).toBeGreaterThan(12);
  await page.keyboard.up('ArrowRight');
  const released=(await state(page)).position;
  expect(released[0]).toBeGreaterThan(0);
  await page.waitForTimeout(1700);
  const afterIdle=await state(page);
  expect(afterIdle.position[0]).toBeCloseTo(released[0],6);
  expect(afterIdle.position[1]).toBe(released[1]);
  await expect.poll(async()=>(await state(page)).audio.level).toBeGreaterThan(.00001);
  await page.locator('#sound-toggle').click();
  await expect.poll(async()=>(await state(page)).audio.level).toBeLessThan(.000001);
  await page.locator('#sound-toggle').click();
  await expect.poll(async()=>(await state(page)).audio.level).toBeGreaterThan(.00001);
  await page.locator('#help-toggle').click();const paused=await state(page);
  await page.waitForTimeout(400);expect((await state(page)).elapsed).toBe(paused.elapsed);
  await expect.poll(async()=>(await state(page)).audio.level).toBeLessThan(.000001);
  await page.locator('#volume-control').focus();
  await page.locator('#volume-control').press('ArrowLeft');
  await expect(page.locator('#volume-value')).toHaveText('34%');
  expect((await state(page)).audio.volume).toBe(.34);
  await page.locator('#close-help').click();
  await page.locator('#home-button').click();
  await expect(page.locator('#hangar-ui')).toBeVisible();
  expect((await state(page)).gearDown).toBe(true);
  expect((await state(page)).wheelCount).toBe(22);
  await expect.poll(async()=>(await state(page)).audio.level).toBeLessThan(.000001);
  expect(errors).toEqual([]);
});

test('difficulty changes actual obstacle density and collisions cause falling, retry and ground crash', async ({page})=>{
  await ready(page);
  await page.locator('[data-difficulty="normal"]').click();
  await page.locator('#start-button').click();
  expect((await state(page)).obstacles).toHaveLength(8);
  expect((await state(page)).speed).toBe(27);
  await page.locator('#home-button').click();
  await page.locator('[data-difficulty="hard"]').click();
  await page.locator('#start-button').click();
  expect((await state(page)).obstacles).toHaveLength(12);
  const firstX=(await state(page)).obstacles[0].position[0];
  await page.waitForTimeout(600);
  expect((await state(page)).obstacles[0].position[0]).not.toBe(firstX);
  await expect.poll(async()=>(await state(page)).phase,{timeout:25000,intervals:[100,250]}).toBe('falling');
  await expect(page.locator('#crash-panel')).toBeVisible({timeout:15000});
  await expect.poll(async()=>(await state(page)).audio.level).toBeLessThan(.000001);
  await expect(page.locator('#crash-reason')).toContainText('热气球');
  await page.screenshot({path:'/tmp/little-sky-crash.png'});
  await page.locator('#retry-button').click();
  expect((await state(page)).phase).toBe('flying');expect((await state(page)).score).toBe(0);
  await page.keyboard.down('ArrowRight');await page.keyboard.down('ArrowUp');
  await expect.poll(async()=>(await state(page)).position[0]).toBeGreaterThan(18);
  await page.keyboard.up('ArrowRight');await page.keyboard.up('ArrowUp');
  await expect(page.locator('#crash-panel')).toBeVisible({timeout:25000});
  expect((await state(page)).failureReason).toBe('route');
  expect((await state(page)).misses).toBe(3);
  await expect(page.locator('#crash-title')).toContainText('航线');
  await page.locator('#crash-home-button').click();
  await page.locator('[data-difficulty="easy"]').click();
  await page.locator('#start-button').click();
  await page.keyboard.down('ArrowDown');
  await expect.poll(async()=>(await state(page)).phase,{timeout:12000}).toBe('falling');
  await page.keyboard.up('ArrowDown');
  await expect(page.locator('#crash-panel')).toBeVisible({timeout:10000});
  await expect(page.locator('#crash-reason')).toContainText('地面');
  await page.locator('#crash-home-button').click();
  await expect(page.locator('#hangar-ui')).toBeVisible();
});

test('mobile zoom, difficulty and touch flight controls fit the screen',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const page=await context.newPage();await page.goto('http://127.0.0.1:5173');
  await expect(page.locator('#loading')).toBeHidden();
  await page.locator('[data-id="747"]').tap();
  for(const id of ['zoom-in','zoom-out','zoom-reset'])await page.locator(`#${id}`).tap();
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:290},{x:240,y:290}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:115,y:290},{x:275,y:290}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect((await state(page)).zoom).toBeGreaterThan(1.5);
  await page.locator('#zoom-reset').tap();
  await page.locator('[data-difficulty="easy"]').tap();
  for(const selector of ['#difficulty-list','#start-button','#inspection-controls']){
    const bounds=await page.locator(selector).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(844);
  }
  await page.screenshot({path:'/tmp/little-sky-mobile.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.locator('#start-button').tap();
  for(const direction of ['up','left','right','down'])await page.locator(`[data-direction="${direction}"]`).tap();
  await page.screenshot({path:'/tmp/little-sky-mobile-flight.png'});
  await page.locator('#home-button').tap();await context.close();
});

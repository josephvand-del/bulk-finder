/* Bulk Finder v3.23 — multi-set LEGO bulk-hunt tracker.
 *
 * Single-page app, no framework. Static files on GitHub Pages.
 * Backend: Supabase (Postgres + Auth). The app is LOCAL-FIRST:
 * every tap saves to this device immediately (localStorage), then
 * syncs to Supabase in the background with a retry queue when the
 * user is logged in and online. A failed sync never wipes local
 * progress — the queue just retries later. Live sync (v3.3): a
 * logged-in device also listens for changes from other devices
 * (Supabase Realtime) and re-pulls the open sets every 20s, so a tap
 * on one device shows up on the other without a refresh.
 *
 * Tables (in the "bulk finder" Supabase project):
 *   public.user_sets — one row per set a user tracks
 *   public.set_parts — one row per part lot, qty_remaining is the
 *   live count. Unique on (user_set_id, part_key).
 *   public.set_inventories — one row per LEGO set number, holding
 *   the converted inventory. Public read; only the import-set Edge
 *   Function writes (service_role).
 * Edge Function import-set — POST { set_num } looks a set up on
 * Rebrickable, converts it with Joseph's category/colour rules,
 * caches it in set_inventories, and returns it.
 * Row Level Security: a user can only touch their own rows.
 */

'use strict';

/* ---------- Config ---------- */
// Supabase project "bulk finder". The publishable key is public by
// design (it is the anon key) — it is safe to ship in this file.
// There is no service_role key anywhere in this app.
var SUPABASE_URL = 'https://xwekulsnfarjibawqqih.supabase.co';
var SUPABASE_KEY = 'sb_publishable_EIBE-riBIT2UCrfP0X0HmA_gUSRTGpD';

// 8961-1 "Crystal Sweeper" inventory — the audited, fixed list from
// ~/workspace/research_notes/lego-8961-1-tracker/data.json
// (138 lots, 430 pieces, catapult removed, rock monsters kept).
// Injected verbatim at build time; do not hand-edit.
var INVENTORY_8961 = {"set": "8961-1 Crystal Sweeper", "set_img_url": "https://cdn.rebrickable.com/media/sets/8961-1.jpg", "lots": 138, "pieces": 430, "tiers": {"1": "MOST LIKELY IN BULK", "2": "MEDIUM \u2014 WORTH A DIG", "3": "LEAST LIKELY IN BULK"}, "items": [{"id": "300126-3001-Black", "qty": 16, "dim": "2 \u00d7 4 studs", "colour": "Black", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/300126.jpg"}, {"id": "4121715-2780-Black", "qty": 8, "dim": "2 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Pins / Bushes", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4121715.jpg"}, {"id": "614126-6141-Black", "qty": 4, "dim": "1 \u00d7 1 studs", "colour": "", "any": true, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/614126.jpg"}, {"id": "4535739-63868-Black", "qty": 4, "dim": "2 \u00d7 1 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4535739.jpg"}, {"id": "4556158-60470-Black", "qty": 4, "dim": "1 \u00d7 2 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4556158.jpg"}, {"id": "302026-3020-Black", "qty": 2, "dim": "2 \u00d7 4 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/302026.jpg"}, {"id": "403226-4032-Black", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/403226.jpg"}, {"id": "4569733-88072-Black", "qty": 2, "dim": "1 \u00d7 2 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4569733.jpg"}, {"id": "370826-3708-Black", "qty": 2, "dim": "12 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/370826.jpg"}, {"id": "4526982-62462-Black", "qty": 2, "dim": "2 studs long", "colour": "", "any": true, "tier": 1, "cat": "Tubes and Hoses", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4526982.jpg"}, {"id": "416226-4162-Black", "qty": 2, "dim": "1 \u00d7 8 studs", "colour": "Black", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/416226.jpg"}, {"id": "4158848-30552-Black", "qty": 1, "dim": "1 stud", "colour": "", "any": true, "tier": 1, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4158848.jpg"}, {"id": "370726-3707-Black", "qty": 1, "dim": "8 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/370726.jpg"}, {"id": "4211086-6587-Dark_Stone_Grey", "qty": 13, "dim": "3 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211086.jpg"}, {"id": "4508553-59426-Dark_Stone_Grey", "qty": 4, "dim": "5\u00bd studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4508553.jpg"}, {"id": "4210798-6112-Dark_Stone_Grey", "qty": 2, "dim": "1 \u00d7 12 studs", "colour": "", "any": true, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4210798.jpg"}, {"id": "4211061-3035-Dark_Stone_Grey", "qty": 2, "dim": "4 \u00d7 8 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211061.jpg"}, {"id": "4256149-3028-Dark_Stone_Grey", "qty": 2, "dim": "6 \u00d7 12 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4256149.jpg"}, {"id": "4211055-3068-Dark_Stone_Grey", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211055.jpg"}, {"id": "4211396-3021-Medium_Stone_Grey", "qty": 12, "dim": "2 \u00d7 3 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211396.jpg"}, {"id": "4211622-6590-Medium_Stone_Grey", "qty": 9, "dim": "1 stud", "colour": "", "any": true, "tier": 1, "cat": "Technic Pins / Bushes", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211622.jpg"}, {"id": "4521921-54200-Medium_Stone_Grey", "qty": 8, "dim": "1 \u00d7 1 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4521921.jpg"}, {"id": "4211503-4599-Medium_Stone_Grey", "qty": 6, "dim": "1 \u00d7 1 stud", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Miscellaneous", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211503.jpg"}, {"id": "4211639-32073-Medium_Stone_Grey", "qty": 6, "dim": "5 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211639.jpg"}, {"id": "4515369-60478-Medium_Stone_Grey", "qty": 4, "dim": "1 \u00d7 2 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4515369.jpg"}, {"id": "4211406-3034-Medium_Stone_Grey", "qty": 3, "dim": "2 \u00d7 8 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211406.jpg"}, {"id": "4211397-3022-Medium_Stone_Grey", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211397.jpg"}, {"id": "4211360-2445-Medium_Stone_Grey", "qty": 1, "dim": "2 \u00d7 12 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211360.jpg"}, {"id": "4211526-6143-Medium_Stone_Grey", "qty": 1, "dim": "\u00d816 mm", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211526.jpg"}, {"id": "4211696-30388-Medium_Stone_Grey", "qty": 1, "dim": "1 \u00d7 6 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211696.jpg"}, {"id": "4215971-40902-Medium_Stone_Grey", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4215971.jpg"}, {"id": "4211483-4274-Medium_Stone_Grey", "qty": 1, "dim": "1 stud", "colour": "", "any": true, "tier": 1, "cat": "Technic Pins / Bushes", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211483.jpg"}, {"id": "4211805-44294-Medium_Stone_Grey", "qty": 1, "dim": "7 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211805.jpg"}, {"id": "302201-3022-White", "qty": 3, "dim": "2 \u00d7 2 studs", "colour": "White", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/302201.jpg"}, {"id": "4140583-2540-White", "qty": 3, "dim": "1 \u00d7 2 studs", "colour": "White", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4140583.jpg"}, {"id": "408501-4085-White", "qty": 2, "dim": "1 \u00d7 1 studs", "colour": "White", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/408501.jpg"}, {"id": "4533763-60475-White", "qty": 2, "dim": "1 \u00d7 1 studs", "colour": "White", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4533763.jpg"}, {"id": "379401-3794-White", "qty": 1, "dim": "1 \u00d7 2 studs", "colour": "White", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/379401.jpg"}, {"id": "379501-3795-White", "qty": 1, "dim": "2 \u00d7 6 studs", "colour": "White", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/379501.jpg"}, {"id": "3005740-30057-Transparent", "qty": 6, "dim": "1 \u00d7 1 studs", "colour": "Clear", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/3005740.jpg"}, {"id": "4206482-43093-Bright_Blue", "qty": 6, "dim": "1 stud", "colour": "Blue", "any": false, "tier": 1, "cat": "Technic Pins / Bushes", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4206482.jpg"}, {"id": "4239601-32123-Bright_Yellow", "qty": 6, "dim": "\u00bd stud", "colour": "", "any": true, "tier": 1, "cat": "Technic Pins / Bushes", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4239601.jpg"}, {"id": "4164022-3004-Bright_Yellowish_Green", "qty": 13, "dim": "1 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4164022.jpg"}, {"id": "4164037-3023-Bright_Yellowish_Green", "qty": 13, "dim": "1 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4164037.jpg"}, {"id": "4220631-3002-Bright_Yellowish_Green", "qty": 10, "dim": "2 \u00d7 3 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4220631.jpg"}, {"id": "4187743-3710-Bright_Yellowish_Green", "qty": 7, "dim": "1 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4187743.jpg"}, {"id": "4212446-6091-Bright_Yellowish_Green", "qty": 6, "dim": "1 \u00d7 1 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4212446.jpg"}, {"id": "4537927-61678-Bright_Yellowish_Green", "qty": 6, "dim": "1 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4537927.jpg"}, {"id": "4164021-2431-Bright_Yellowish_Green", "qty": 4, "dim": "1 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4164021.jpg"}, {"id": "4220632-3003-Bright_Yellowish_Green", "qty": 4, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4220632.jpg"}, {"id": "4160593-2431-Bright_Orange", "qty": 3, "dim": "1 \u00d7 4 studs", "colour": "Orange", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4160593.jpg"}, {"id": "4158355-3020-Bright_Orange", "qty": 2, "dim": "2 \u00d7 4 studs", "colour": "Orange", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4158355.jpg"}, {"id": "4234716-3010-Bright_Yellowish_Green", "qty": 2, "dim": "1 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4234716.jpg"}, {"id": "4500755-52031-Bright_Yellowish_Green", "qty": 2, "dim": "4 \u00d7 6 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4500755.jpg"}, {"id": "4504705-30565-Bright_Yellowish_Green", "qty": 2, "dim": "4 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4504705.jpg"}, {"id": "4529160-3666-Bright_Yellowish_Green", "qty": 2, "dim": "1 \u00d7 6 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4529160.jpg"}, {"id": "4541490-44126-Bright_Yellowish_Green", "qty": 2, "dim": "2 \u00d7 6 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541490.jpg"}, {"id": "3000841-30008-Transparent_Red", "qty": 2, "dim": "1 \u00d7 1 studs", "colour": "Trans-Red", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/3000841.jpg"}, {"id": "4538144-62462-Bright_Orange", "qty": 1, "dim": "2 studs long", "colour": "", "any": true, "tier": 1, "cat": "Tubes and Hoses", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538144.jpg"}, {"id": "4504850-3031-Bright_Yellowish_Green", "qty": 1, "dim": "4 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4504850.jpg"}, {"id": "4541957-4150-Bright_Yellowish_Green", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541957.jpg"}, {"id": "4299389-56145-Black", "qty": 6, "dim": "\u00d830 mm", "colour": "Black", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4299389.jpg"}, {"id": "370126-3701-Black", "qty": 2, "dim": "1 \u00d7 4 studs", "colour": "", "any": true, "tier": 2, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/370126.jpg"}, {"id": "4100423-6087-Black", "qty": 2, "dim": "2 \u00d7 5 studs", "colour": "", "any": true, "tier": 2, "cat": "Miscellaneous", "img": "https://img.bricklink.com/ItemImage/PN/11/6087.png"}, {"id": "4216660-30367-Black", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4216660.jpg"}, {"id": "4244953-50861-Black", "qty": 2, "dim": "\u00d821 mm", "colour": "Black", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4244953.jpg"}, {"id": "4502834-53992-Black", "qty": 2, "dim": "\u22482 studs long", "colour": "Black", "any": false, "tier": 2, "cat": "Technic Special", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4502834.jpg"}, {"id": "4538456-64644-Black", "qty": 2, "dim": "\u22483 studs long", "colour": "Black", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538456.jpg"}, {"id": "4112282-6629-Black", "qty": 2, "dim": "4 \u00d7 6 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Technic Beams", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4112282.jpg"}, {"id": "602026-6020-Black", "qty": 1, "dim": "1 \u00d7 4 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Bars, Ladders and Fences", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/602026.jpg"}, {"id": "4153044-30663-Black", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Miscellaneous", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4153044.jpg"}, {"id": "4527063-62698-Black", "qty": 1, "dim": "1 \u00d7 2 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4527063.jpg"}, {"id": "4211064-3747-Dark_Stone_Grey", "qty": 8, "dim": "2 \u00d7 3 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211064.jpg"}, {"id": "4210631-2412-Dark_Stone_Grey", "qty": 6, "dim": "1 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4210631.jpg"}, {"id": "4540386-61409-Dark_Stone_Grey", "qty": 4, "dim": "1 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540386.jpg"}, {"id": "4514558-3648-Dark_Stone_Grey", "qty": 3, "dim": "\u00d824 mm", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4514558.jpg"}, {"id": "4161674-30367-Dark_Stone_Grey", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4161674.jpg"}, {"id": "4210645-30170-Dark_Stone_Grey", "qty": 2, "dim": "minifig", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4210645.jpg"}, {"id": "4219725-3633-Dark_Stone_Grey", "qty": 2, "dim": "1 \u00d7 4 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Bars, Ladders and Fences", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4219725.jpg"}, {"id": "4520307-61780-Dark_Stone_Grey", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Miscellaneous", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4520307.jpg"}, {"id": "4211054-3039-Dark_Stone_Grey", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211054.jpg"}, {"id": "4516456-60169-Dark_Stone_Grey", "qty": 1, "dim": "16 studs long", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "String, Bands and Reels", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4516456.jpg"}, {"id": "4522784-47455-Dark_Stone_Grey", "qty": 1, "dim": "\u22482 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Technic Connectors", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4522784.jpg"}, {"id": "4277927-44728-Medium_Stone_Grey", "qty": 4, "dim": "1 \u00d7 2 studs", "colour": "Light Grey", "any": false, "tier": 2, "cat": "Plates Special", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4277927.jpg"}, {"id": "4211847-30360-Medium_Stone_Grey", "qty": 2, "dim": "3 \u00d7 3 studs", "colour": "Light Grey", "any": false, "tier": 2, "cat": "Technic Steering, Suspension and Engine", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211847.jpg"}, {"id": "4590443-50862-Medium_Stone_Grey", "qty": 2, "dim": "\u00d815 mm", "colour": "Light Grey", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4590443.jpg"}, {"id": "4211819-4515-Medium_Stone_Grey", "qty": 1, "dim": "6 \u00d7 8 studs", "colour": "", "any": true, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211819.jpg"}, {"id": "4523403-60779-White", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "White", "any": false, "tier": 2, "cat": "Flags, Banners and Signs", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4523403.jpg"}, {"id": "4521210-60592-White", "qty": 1, "dim": "1 \u00d7 2 studs", "colour": "White", "any": false, "tier": 2, "cat": "Windows and Doors", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4521210.jpg"}, {"id": "4278412-54196-Transparent", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Clear", "any": false, "tier": 2, "cat": "Plates Round Curved and Dishes", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4278412.jpg"}, {"id": "281721-2817-Bright_Red", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Red", "any": false, "tier": 2, "cat": "Technic Special", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/281721.jpg"}, {"id": "4538780-64728-Bright_Red", "qty": 2, "dim": "\u22481 stud", "colour": "Red", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538780.jpg"}, {"id": "4540418-30325-Bright_Blue", "qty": 2, "dim": "minifig", "colour": "Blue", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540418.jpg"}, {"id": "4114584-33085-Bright_Yellow", "qty": 1, "dim": "\u22481 stud", "colour": "Yellow", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4114584.jpg"}, {"id": "4540385-61409-Bright_Yellowish_Green", "qty": 8, "dim": "1 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540385.jpg"}, {"id": "4494219-4185-Bright_Yellowish_Green", "qty": 8, "dim": "\u00d824 mm", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4494219.jpg"}, {"id": "4540817-32348-Bright_Orange", "qty": 6, "dim": "4 \u00d7 4 studs", "colour": "Orange", "any": false, "tier": 2, "cat": "Technic Beams", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540817.jpg"}, {"id": "4529679-3660-Bright_Yellowish_Green", "qty": 4, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4529679.jpg"}, {"id": "4244369-50746-Transparent_Bright_Orange", "qty": 4, "dim": "1 \u00d7 1 studs", "colour": "Trans-Orange", "any": false, "tier": 2, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4244369.jpg"}, {"id": "4540299-64711-Bright_Orange", "qty": 2, "dim": "\u00d862 mm", "colour": "Orange", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540299.jpg"}, {"id": "4529045-33243-Bright_Yellowish_Green", "qty": 2, "dim": "1 \u00d7 3 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Bricks Curved", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4529045.jpg"}, {"id": "4261453-6536-Bright_Yellowish_Green", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Technic Connectors", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4261453.jpg"}, {"id": "4265684-32523-Bright_Yellowish_Green", "qty": 2, "dim": "3 studs long", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Technic Beams", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4265684.jpg"}, {"id": "4508713-32009-Bright_Yellowish_Green", "qty": 2, "dim": "3 \u00d7 7 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Technic Beams", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4508713.jpg"}, {"id": "4119483-30153-Transparent_Blue", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Blue", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4119483.jpg"}, {"id": "4541538-30385-Transparent_Blue", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Blue", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541538.jpg"}, {"id": "4541536-30385-Transparent_Bright_Orange", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Orange", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541536.jpg"}, {"id": "4114505-30153-Transparent_Fluorescent_Green", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Green", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4114505.jpg"}, {"id": "4541537-30385-Transparent_Red", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Red", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541537.jpg"}, {"id": "4518029-59900-Bright_Orange", "qty": 1, "dim": "1 \u00d7 1 studs", "colour": "Orange", "any": false, "tier": 2, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4518029.jpg"}, {"id": "4537923-30499-Bright_Yellowish_Green", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4537923.jpg"}, {"id": "4552036-86209-Transparent_Brown", "qty": 1, "dim": "1 \u00d7 2 studs", "colour": "Trans-Brown", "any": false, "tier": 2, "cat": "Windows and Doors", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4552036.jpg"}, {"id": "4544720-64288-Transparent_Red", "qty": 1, "dim": "1 \u00d7 1 studs", "colour": "Trans-Red", "any": false, "tier": 2, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4544720.jpg"}, {"id": "4107558-32018-Black", "qty": 4, "dim": "1 \u00d7 14 studs", "colour": "Black", "any": false, "tier": 3, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4107558.jpg"}, {"id": "4530673-50859-Black", "qty": 1, "dim": "6 studs long", "colour": "Black", "any": false, "tier": 3, "cat": "Transportation - Land", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4530673.jpg"}, {"id": "4539385-64450-Black", "qty": 1, "dim": "4 \u00d7 6 studs", "colour": "Black", "any": false, "tier": 3, "cat": "Miscellaneous", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4539385.jpg"}, {"id": "4211006-3837-Dark_Stone_Grey", "qty": 1, "dim": "\u22483 studs long", "colour": "Dark Grey", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211006.jpg"}, {"id": "4542545-76382-Medium_Stone_Grey", "qty": 1, "dim": "minifig torso", "colour": "Light Grey", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542545.jpg"}, {"id": "4538783-64713-Medium_Stone_Grey", "qty": 1, "dim": "4 \u00d7 4 studs", "colour": "Light Grey", "any": false, "tier": 3, "cat": "Bricks Round and Cones", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538783.jpg"}, {"id": "73737-73587-White", "qty": 4, "dim": "\u22482 studs long", "colour": "White", "any": false, "tier": 3, "cat": "Miscellaneous", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/73737.jpg"}, {"id": "4542547-76382-White", "qty": 1, "dim": "minifig torso", "colour": "White", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542547.jpg"}, {"id": "85418-85418-White", "qty": 1, "dim": "sticker sheet", "colour": "White", "any": false, "tier": 3, "cat": "Stickers", "img": "http://media.peeron.com/pics/inv/custpics/thumbs/85418.1246725805.jpg"}, {"id": "4542552-85107-Bright_Blue", "qty": 2, "dim": "minifig legs", "colour": "Blue", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542552.jpg"}, {"id": "4542171-64881-Bright_Yellow", "qty": 1, "dim": "minifig head", "colour": "Yellow", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542171.jpg"}, {"id": "4542175-64882-Bright_Yellow", "qty": 1, "dim": "minifig head", "colour": "Yellow", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542175.jpg"}, {"id": "4281515-41669-Bright_Orange", "qty": 24, "dim": "3 studs long", "colour": "Orange", "any": false, "tier": 3, "cat": "Bionicle, Hero Factory and Constraction", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4281515.jpg"}, {"id": "4508647-2634-{Not_Specified}", "qty": 1, "dim": "2 \u00d7 8 studs", "colour": "White", "any": false, "tier": 3, "cat": "Windows and Doors", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4508647.jpg"}, {"id": "4521107-50860-Bright_Orange", "qty": 1, "dim": "\u22486 studs long", "colour": "Orange", "any": false, "tier": 3, "cat": "Transportation - Land", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4521107.jpg"}, {"id": "4538363-30300-Bright_Orange", "qty": 1, "dim": "8 \u00d7 12 studs", "colour": "Orange", "any": false, "tier": 3, "cat": "Plates Special", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538363.jpg"}, {"id": "4541465-64786-Transparent_Blue", "qty": 1, "dim": "\u22482 \u00d7 2 studs", "colour": "Trans-Blue", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541465.jpg"}, {"id": "4538017-64786-Transparent_Red", "qty": 1, "dim": "\u22482 \u00d7 2 studs", "colour": "Trans-Red", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538017.jpg"}, {"id": "4186017-6562-Brick_Yellow", "qty": 1, "dim": "3 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Pins / Bushes", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4186017.jpg"}, {"id": "4210677-30088-Dark_Stone_Grey", "qty": 1, "dim": "5 studs long", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4210677.jpg"}, {"id": "4225973-48169-Dark_Stone_Grey", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 3, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4225973.jpg"}, {"id": "4225975-48171-Dark_Stone_Grey", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 3, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4225975.jpg"}, {"id": "4261715-3297-Dark_Stone_Grey", "qty": 2, "dim": "3 \u00d7 4 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4261715.jpg"}, {"id": "4528323-60474-Dark_Stone_Grey", "qty": 1, "dim": "4 \u00d7 4 studs", "colour": "Dark Grey", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4528323.jpg"}, {"id": "4517986-61485-Black", "qty": 1, "dim": "4 \u00d7 4 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Hinges, Arms and Turntables", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4517986.jpg"}]};
// One-time import snapshot: Joseph's progress in the old Muse-hosted
// 8961-1 tracker, as of 2026-11-15 09:26 MST — 340 of 430 found, 96 of 138
// lots done. Key = lot id, value = pieces still to find. Used only by
// importOldProgress(); never fetched from the network.
const IMPORT_8961_PROGRESS = {"300126-3001-Black":0,"4121715-2780-Black":0,"614126-6141-Black":0,"4535739-63868-Black":0,"4556158-60470-Black":0,"302026-3020-Black":0,"403226-4032-Black":0,"4569733-88072-Black":0,"370826-3708-Black":0,"4526982-62462-Black":0,"416226-4162-Black":0,"4158848-30552-Black":0,"370726-3707-Black":0,"4211086-6587-Dark_Stone_Grey":0,"4508553-59426-Dark_Stone_Grey":0,"4210798-6112-Dark_Stone_Grey":0,"4211061-3035-Dark_Stone_Grey":0,"4256149-3028-Dark_Stone_Grey":0,"4211055-3068-Dark_Stone_Grey":0,"4211396-3021-Medium_Stone_Grey":0,"4211622-6590-Medium_Stone_Grey":0,"4521921-54200-Medium_Stone_Grey":0,"4211503-4599-Medium_Stone_Grey":0,"4211639-32073-Medium_Stone_Grey":0,"4515369-60478-Medium_Stone_Grey":0,"4211406-3034-Medium_Stone_Grey":0,"4211397-3022-Medium_Stone_Grey":0,"4211360-2445-Medium_Stone_Grey":0,"4211526-6143-Medium_Stone_Grey":0,"4211696-30388-Medium_Stone_Grey":1,"4215971-40902-Medium_Stone_Grey":1,"4211483-4274-Medium_Stone_Grey":0,"4211805-44294-Medium_Stone_Grey":0,"302201-3022-White":0,"4140583-2540-White":0,"408501-4085-White":0,"4533763-60475-White":0,"379401-3794-White":0,"379501-3795-White":0,"3005740-30057-Transparent":0,"4206482-43093-Bright_Blue":0,"4239601-32123-Bright_Yellow":0,"4164022-3004-Bright_Yellowish_Green":0,"4164037-3023-Bright_Yellowish_Green":0,"4220631-3002-Bright_Yellowish_Green":0,"4187743-3710-Bright_Yellowish_Green":0,"4212446-6091-Bright_Yellowish_Green":0,"4537927-61678-Bright_Yellowish_Green":0,"4164021-2431-Bright_Yellowish_Green":0,"4220632-3003-Bright_Yellowish_Green":0,"4160593-2431-Bright_Orange":2,"4158355-3020-Bright_Orange":0,"4234716-3010-Bright_Yellowish_Green":0,"4500755-52031-Bright_Yellowish_Green":1,"4504705-30565-Bright_Yellowish_Green":0,"4529160-3666-Bright_Yellowish_Green":0,"4541490-44126-Bright_Yellowish_Green":2,"3000841-30008-Transparent_Red":0,"4538144-62462-Bright_Orange":1,"4504850-3031-Bright_Yellowish_Green":0,"4541957-4150-Bright_Yellowish_Green":0,"4299389-56145-Black":0,"370126-3701-Black":0,"4100423-6087-Black":2,"4216660-30367-Black":2,"4244953-50861-Black":0,"4502834-53992-Black":0,"4538456-64644-Black":0,"4112282-6629-Black":0,"602026-6020-Black":0,"4153044-30663-Black":1,"4527063-62698-Black":1,"4211064-3747-Dark_Stone_Grey":0,"4210631-2412-Dark_Stone_Grey":0,"4540386-61409-Dark_Stone_Grey":0,"4514558-3648-Dark_Stone_Grey":0,"4161674-30367-Dark_Stone_Grey":2,"4210645-30170-Dark_Stone_Grey":2,"4219725-3633-Dark_Stone_Grey":2,"4520307-61780-Dark_Stone_Grey":2,"4211054-3039-Dark_Stone_Grey":0,"4516456-60169-Dark_Stone_Grey":1,"4522784-47455-Dark_Stone_Grey":0,"4277927-44728-Medium_Stone_Grey":0,"4211847-30360-Medium_Stone_Grey":0,"4590443-50862-Medium_Stone_Grey":2,"4211819-4515-Medium_Stone_Grey":1,"4523403-60779-White":2,"4521210-60592-White":1,"4278412-54196-Transparent":2,"281721-2817-Bright_Red":2,"4538780-64728-Bright_Red":1,"4540418-30325-Bright_Blue":1,"4114584-33085-Bright_Yellow":1,"4540385-61409-Bright_Yellowish_Green":0,"4494219-4185-Bright_Yellowish_Green":0,"4540817-32348-Bright_Orange":6,"4529679-3660-Bright_Yellowish_Green":0,"4244369-50746-Transparent_Bright_Orange":0,"4540299-64711-Bright_Orange":0,"4529045-33243-Bright_Yellowish_Green":0,"4261453-6536-Bright_Yellowish_Green":0,"4265684-32523-Bright_Yellowish_Green":0,"4508713-32009-Bright_Yellowish_Green":0,"4119483-30153-Transparent_Blue":2,"4541538-30385-Transparent_Blue":2,"4541536-30385-Transparent_Bright_Orange":2,"4114505-30153-Transparent_Fluorescent_Green":2,"4541537-30385-Transparent_Red":2,"4518029-59900-Bright_Orange":0,"4537923-30499-Bright_Yellowish_Green":1,"4552036-86209-Transparent_Brown":1,"4544720-64288-Transparent_Red":0,"4107558-32018-Black":0,"4530673-50859-Black":0,"4539385-64450-Black":1,"4211006-3837-Dark_Stone_Grey":0,"4542545-76382-Medium_Stone_Grey":0,"4538783-64713-Medium_Stone_Grey":1,"73737-73587-White":4,"4542547-76382-White":0,"85418-85418-White":1,"4542552-85107-Bright_Blue":0,"4542171-64881-Bright_Yellow":0,"4542175-64882-Bright_Yellow":0,"4281515-41669-Bright_Orange":24,"4508647-2634-{Not_Specified}":1,"4521107-50860-Bright_Orange":0,"4538363-30300-Bright_Orange":1,"4541465-64786-Transparent_Blue":1,"4538017-64786-Transparent_Red":1,"4186017-6562-Brick_Yellow":0,"4210677-30088-Dark_Stone_Grey":1,"4225973-48169-Dark_Stone_Grey":0,"4225975-48171-Dark_Stone_Grey":0,"4261715-3297-Dark_Stone_Grey":0,"4528323-60474-Dark_Stone_Grey":0,"4517986-61485-Black":0};

/* ---------- Supabase client (guarded: guest mode works offline) ---------- */
var sb = null;
if (window.supabase && window.supabase.createClient) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

/* ---------- Colour families ----------
 * The colour filter folds transparent variants into their base colour.
 * Every lot shows its colour family on its card; lots that used to be
 * "any colour" show the colour pictured in the photo (the 3rd segment
 * of the lot id). */
var TRANS_FAMILY = {
  'Trans-Orange': 'Orange',
  'Trans-Blue': 'Blue',
  'Trans-Red': 'Red',
  'Trans-Green': 'Lime Green'
};
// Pictured colour (id segment, LEGO colour names) -> display family.
var PICTURED_FAMILY = {
  'Black': 'Black',
  'Dark_Stone_Grey': 'Dark Grey',
  'Medium_Stone_Grey': 'Light Grey',
  'Bright_Yellow': 'Yellow',
  'Bright_Orange': 'Orange',
  'Brick_Yellow': 'Tan'
};

function picturedColour(item) {
  var seg = item.id.split('-')[2] || '';
  return PICTURED_FAMILY[seg] || seg.replace(/_/g, ' ');
}

// The colour family a lot belongs to, for filtering and counting.
function familyOf(item) {
  if (!item.any) return TRANS_FAMILY[item.colour] || item.colour;
  return picturedColour(item);
}

/* The colour printed on the card: the lot's colour family — for lots that
 * used to be "any colour", the colour pictured in the photo. */
function displayColour(item) { return familyOf(item); }

/* Piece type: the lot's raw category (Rebrickable, with Joseph's merges:
 * Tiles fold into Plates — "anything flat is a plate" — and every
 * Minifig* category folds into 'Minifig / Accessories' (pieces, figures
 * and accessories in one bucket, so no minifig lot ever lands in
 * Miscellaneous). 'Bricks Special' + 'Containers' fold into
 * 'Miscellaneous' (the old 'Random' bucket is gone), and Technic Pins
 * and Technic Bushes are one category, 'Technic Pins / Bushes'.
 * Small pieces is the one non-Rebrickable bucket: 1x1 / single-stud
 * bricks and plates. Future sets from the Rebrickable lookup carry
 * their own part_cat_id, so this dropdown works for any set with no
 * hand-mapping.
 *
 * Display rule (Joseph's audit, 2026-11-15): a raw category keeps its own
 * section only while 3 or more of its lots still have pieces left to find
 * — fewer than 3 open lots folds into 'Miscellaneous' at display time, so
 * tiny sections never get their own dropdown entry. Windows and Doors
 * (3 lots) is the smallest section that stands on its own.
 * 'Minifig / Accessories' is exempt — he placed the minifig gear there
 * on purpose. Empty categories never appear: the dropdown is built
 * from the lots that are actually there. */
function itemCat(item) { return item.cat || 'Other'; }

// Lots still open (pieces remaining) per raw category, per set — rebuilt
// when the selection loads and whenever a count changes, so the fold
// follows what is actually left to find, not the full inventory.
var catLotCount = {};
function rebuildCatCounts() {
  catLotCount = {};
  items.forEach(function (it) {
    if (remOf(it) <= 0) return; // a fully found lot no longer holds a section open
    var m = catLotCount[it.setKey] || (catLotCount[it.setKey] = {});
    var c = itemCat(it);
    m[c] = (m[c] || 0) + 1;
  });
}

// The category shown in the type dropdown and used by the type filter.
function displayCat(item) {
  var raw = itemCat(item);
  if (raw === 'Miscellaneous' || raw === 'Minifig / Accessories') return raw;
  var m = catLotCount[item.setKey];
  if (m && (m[raw] || 0) <= 2) return 'Miscellaneous';
  return raw;
}

/* Piece number = the LEGO design ID (middle segment of the lot id,
 * e.g. 6590). Shown on every card so a mis-sorted piece can be reported
 * by number and re-binned. */
function partNumOf(item) { var parts = String(item.id || '').split('-'); return parts.length > 1 ? parts[1] : ''; }

/* ---------- Local storage ----------
 * bf:sets            — set metas known on this device
 * bf:counts:<setNum> — remaining map { partKey: remaining } for a set
 * bf:cloudIds        — { setNum: user_sets.id } for cloud sets
 * bf:outbox          — pending sync ops (retried until they land)
 * bf:activeSet       — last opened set
 * bf:selectedSets    — set keys shown together in the combined view
 * bf:view            — { date, status, type, colour } for the filter + set
 *                      view (same-day restore; a new day resets to defaults)
 * bf:guestDismissed  — auth card dismissed for this session's guest */
var LS = {
  get: function (k, fallback) {
    try {
      var v = localStorage.getItem(k);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set: function (k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full/blocked: taps still work in memory */ }
  }
};

/* ---------- Sounds ---------- */
// Stud tick when a piece is found (the counter's minus button); the
// minikit jingle when a tap finishes a lot (1 left -> 0). The toggle
// lives in the header; the choice is remembered on this device.
var soundOn = LS.get('bf:soundOn', true);
// The clip as base64 (the 24 KB mp3 is ~32 KB of text). The push tool
// only handles UTF-8 files, so the sound rides inside app.js instead of
// as a separate binary. Regenerate with: base64 -w0 sounds/stud-pickup.mp3
var STUD_SOUND_B64 = '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VLfycJAzLx2dr2advRooUeZbScWIMTzfskhIk4vC1lSx0ugbzc1CiIiqSaSpECoPAcRoG4Tg9lCsmlaxCIgdB0QI0E0k1EbbpRlFEQiIaGyBGodLB8YIG3bmoSIQgqHi6i6xUaGy6BvNzUKIiOqTpVYqHjhdicLhPETnZ2NFCRIi4dizL3K/9GihR8PqqlVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+5Jk3gz1H2YxASZMQgAADSAAAAES1ZKGQyTbSAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//uSZECP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7kmRAj/AAAGkAAAAIAAANIAAAAQAAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+5JkQI/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//uSZECP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7kmRAj/AAAGkAAAAIAAANIAAAAQAAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+5JkQI/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//uSZECP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7kmRAj/AAAGkAAAAIAAANIAAAAQAAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+5JkQI/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//uSZECP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7kmRAj/AAAGkAAAAIAAANIAAAAQAAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+5JkQI/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//uSZECP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7kmRAj/AAAGkAAAAIAAANIAAAAQAAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+5BkQQ/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+5JkQI/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//uSZECP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7kmRAj/AAAGkAAAAIAAANIAAAAQAAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+5JkQI/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//uSZECP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7kmRAj/AAAGkAAAAIAAANIAAAAQAAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=';
var studSound = (typeof Audio !== 'undefined') ? new Audio('data:audio/mpeg;base64,' + STUD_SOUND_B64) : null;
if (studSound) studSound.preload = 'auto';

// The minikit-collect jingle (LEGO Star Wars), 1.1 s, 5 KB. Same
// embedding as the stud clip: base64 in app.js because the push tool
// only handles UTF-8 files. Regenerate with:
// base64 -w0 sounds/minikit-collect.mp3
var MINIKIT_SOUND_B64 = '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';
var minikitSound = (typeof Audio !== 'undefined') ? new Audio('data:audio/mpeg;base64,' + MINIKIT_SOUND_B64) : null;
if (minikitSound) minikitSound.preload = 'auto';

function playStudSound() {
  if (!soundOn || !studSound) return;
  try {
    studSound.currentTime = 0;
    var p = studSound.play();
    if (p && p.catch) p.catch(function () {});
  } catch (e) {}
}

function playMinikitSound() {
  if (!soundOn || !minikitSound) return;
  try {
    minikitSound.currentTime = 0;
    var p = minikitSound.play();
    if (p && p.catch) p.catch(function () {});
  } catch (e) {}
}

function setSoundOn(on) {
  soundOn = !!on;
  LS.set('bf:soundOn', soundOn);
  var btn = $('soundToggleBtn');
  if (btn) {
    btn.textContent = soundOn ? '🔊' : '🔇';
    btn.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
    btn.title = soundOn ? 'Sound on — tap to mute' : 'Sound off — tap to unmute';
  }
}

/* ---------- State ---------- */
var user = null;              // Supabase auth user, or null = guest
var sets = [];                // [{ key, set_num, set_name, total_parts, total_lots, user_set_id }]
var activeSetKey = null;      // set_num of the set the sidebar last opened
var selectedKeys = [];        // set keys shown together in the combined view
var items = [];               // combined inventory of the selected sets (each item carries setKey)
var remainingBySet = {};      // setKey -> { partKey -> pieces still to find }
// Pieces still to find for one combined-view item (its own set's map).
function remOf(item) {
  var map = remainingBySet[item.setKey];
  if (!map) return item.qty;
  return map[item.id] === undefined ? item.qty : map[item.id];
}
var mergedThisSession = {};   // set_num -> true once cloud merge ran
var cloudMergePromises = {};  // set_num -> in-flight cloud-merge promise
var statusFilter = 'needed'; // all | needed | done (Still needed is the default)
var colourFilter = 'all';     // all | family name
var typeFilter = 'all';       // Rebrickable category name, or 'all'

// ---------- View state (filters + set selection) ----------
// Joseph's rule (2026-11-15): a refresh keeps whatever view he's on —
// status, sets, type, colour — but a brand-new day starts fresh at the
// defaults (Still needed, all sets). The view is stamped with the local
// date; a stored view from any other day is ignored and the defaults win.
// Counts are never part of this — they live in bf:counts:<setNum> and a
// refresh or a new day never touches them.
function todayStr() {
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function saveViewState() {
  LS.set('bf:view', { date: todayStr(), status: statusFilter, type: typeFilter, colour: colourFilter });
}
// Restore the saved view when it is from today; otherwise fall back to
// the defaults. Returns true when a same-day view was restored.
function loadViewState() {
  var v = LS.get('bf:view', null);
  var sameDay = !!(v && v.date === todayStr());
  if (sameDay) {
    if (v.status === 'all' || v.status === 'needed' || v.status === 'done') statusFilter = v.status;
    if (typeof v.type === 'string') typeFilter = v.type;
    if (typeof v.colour === 'string') colourFilter = v.colour;
  } else {
    statusFilter = 'needed';
    typeFilter = 'all';
    colourFilter = 'all';
  }
  syncFilterButtons();
  return sameDay;
}
// The status buttons are static HTML — keep the highlighted one on the
// filter that is actually active (restored, default, or just tapped).
function syncFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.filter === statusFilter);
  });
}
// Set once init() has restored the saved view (filters + selection).
// handleAuthChange must not open a set before this is true — it would
// overwrite the saved selection before init has read it.
var viewRestored = false;

var SEED_SET = {
  key: '8961-1',
  set_num: '8961-1',
  set_name: 'Crystal Sweeper',
  total_parts: 430,
  total_lots: 138,
  set_img_url: 'https://cdn.rebrickable.com/media/sets/8961-1.jpg',
  user_set_id: null
};

/* Inventories by set number. 8961-1 is baked in (the audited list);
 * every other set arrives from the set_inventories cache table — the
 * import-set Edge Function writes the row the first time a set is
 * imported, and any device can read it after that (public read). */
var INVENTORIES = { '8961-1': INVENTORY_8961 };
function getInventory(setNum) { return INVENTORIES[setNum] || null; }

async function fetchSetInventory(setNum) {
  if (INVENTORIES[setNum]) return INVENTORIES[setNum];
  if (!sb) return null;
  var res = await sb.from('set_inventories').select('inventory, set_img_url').eq('set_num', setNum).maybeSingle();
  if (res.error || !res.data || !res.data.inventory) return null;
  INVENTORIES[setNum] = res.data.inventory;
  if (res.data.set_img_url) INVENTORIES[setNum].set_img_url = res.data.set_img_url;
  return INVENTORIES[setNum];
}

// Load the inventory for every set in the sidebar list, before open.
async function loadInventoriesForSets() {
  for (var i = 0; i < sets.length; i++) await fetchSetInventory(sets[i].set_num);
}

/* ---------- Small DOM helpers ---------- */
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

/* ---------- Sets: local + cloud ---------- */
function localSets() { return LS.get('bf:sets', []); }
function saveLocalSets(list) { LS.set('bf:sets', list); }

function countsKey(setNum) { return 'bf:counts:' + setNum; }

function loadCounts(setNum) {
  var inv = getInventory(setNum);
  var saved = LS.get(countsKey(setNum), null);
  var map = {};
  if (inv) {
    inv.items.forEach(function (it) {
      // Saved value wins; a lot with no saved row starts at full qty.
      map[it.id] = (saved && typeof saved[it.id] === 'number')
        ? Math.max(0, Math.min(it.qty, saved[it.id])) : it.qty;
    });
  }
  return map;
}
function saveCounts(setNum, map) { LS.set(countsKey(setNum), map); }

function cloudIds() { return LS.get('bf:cloudIds', {}); }
function saveCloudIds(map) { LS.set('bf:cloudIds', map); }

/* ---------- Sync: outbox (retry queue) ---------- */
function outbox() { return LS.get('bf:outbox', []); }
function saveOutbox(list) { LS.set('bf:outbox', list); }

function enqueueSync(op) {
  if (!user) return; // guests have nothing to sync
  var box = outbox();
  box.push(op);
  saveOutbox(box);
  updateSyncStatus();
  processOutbox();
}

// One upsert for a single changed lot.
function enqueuePartSync(setMeta, item) {
  if (!setMeta.user_set_id) return; // no cloud row yet; bulk upload on next open covers it
  enqueueSync({ kind: 'part', user_set_id: setMeta.user_set_id, row: partRow(setMeta.user_set_id, item, remOf(item)) });
}

// One upsert carrying every lot of a set (used when a set is added).
function enqueueBulkSync(setMeta) {
  if (!setMeta.user_set_id) return;
  var inv = getInventory(setMeta.set_num);
  if (!inv) return;
  var map = remainingBySet[setMeta.set_num] || {};
  var rows = inv.items.map(function (it) {
    return partRow(setMeta.user_set_id, it, map[it.id] === undefined ? it.qty : map[it.id]);
  });
  enqueueSync({ kind: 'bulk', user_set_id: setMeta.user_set_id, rows: rows });
}

function partRow(userSetId, item, qtyRemaining) {
  return {
    user_set_id: userSetId,
    part_key: item.id,
    part_num: item.id.split('-')[1] || '',
    color_name: item.colour || picturedColour(item),
    qty_needed: item.qty,
    qty_remaining: qtyRemaining,
    img_url: item.img,
    tier: item.tier,
    is_any_color: !!item.any,
    dimension: item.dim
  };
}

var syncing = false;
async function processOutbox() {
  if (!sb || !user || syncing) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  var box = outbox();
  if (!box.length) { updateSyncStatus(); return; }
  syncing = true;
  updateSyncStatus();
  try {
    while (box.length) {
      var op = box[0];
      var rows = op.kind === 'bulk' ? op.rows : [op.row];
      var res = await sb.from('set_parts').upsert(rows, { onConflict: 'user_set_id,part_key' });
      if (res.error) break; // leave the rest queued; retry later
      box.shift();
      saveOutbox(box);
    }
  } catch (e) {
    // Network blip etc. — queue stays intact, retry later.
  } finally {
    syncing = false;
    updateSyncStatus();
  }
}

var cloudError = null; // last cloud-save failure, shown in the status pill

function updateSyncStatus() {
  var pill = $('syncStatus');
  if (!pill) return;
  if (!user) {
    pill.textContent = 'Guest — saved on this phone only';
    return;
  }
  var pending = outbox().length;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    pill.textContent = pending
      ? 'Offline — ' + pending + ' change' + (pending === 1 ? '' : 's') + ' saved on this phone, will sync later'
      : 'Offline — saved on this phone';
  } else if (syncing || pending) {
    pill.textContent = 'Syncing… (' + pending + ' pending)';
  } else if (cloudError) {
    pill.textContent = 'Cloud save failed — will retry';
  } else {
    pill.textContent = 'Synced';
  }
}

/* ---------- Cloud: sets + merge ---------- */
async function fetchCloudSets() {
  var res = await sb.from('user_sets').select('*').order('created_at', { ascending: true });
  if (res.error) { console.warn('user_sets fetch failed', res.error); return []; }
  return (res.data || []).map(function (r) {
    return {
      key: r.set_num, set_num: r.set_num, set_name: r.set_name,
      total_parts: r.total_parts, total_lots: r.total_lots, user_set_id: r.id
    };
  });
}

async function createCloudSet(meta) {
  if (!user) return null;
  var res = await sb.from('user_sets')
    .upsert({ user_id: user.id, set_num: meta.set_num, set_name: meta.set_name, total_parts: meta.total_parts, total_lots: meta.total_lots }, { onConflict: 'user_id,set_num' })
    .select().single();
  if (res.error) { console.warn('user_sets save failed', res.error); cloudError = res.error.message || 'save failed'; updateSyncStatus(); return null; }
  cloudError = null;
  var ids = cloudIds();
  ids[meta.set_num] = res.data.id;
  saveCloudIds(ids);
  return res.data.id;
}

async function fetchCloudParts(userSetId) {
  var res = await sb.from('set_parts').select('part_key,qty_remaining').eq('user_set_id', userSetId);
  if (res.error) { console.warn('set_parts fetch failed', res.error); return null; }
  return res.data || [];
}

async function uploadAllParts(userSetId, setNum, counts) {
  var inv = getInventory(setNum);
  if (!inv) return false;
  var rows = inv.items.map(function (it) { return partRow(userSetId, it, counts[it.id]); });
  var res = await sb.from('set_parts').upsert(rows, { onConflict: 'user_set_id,part_key' });
  if (res.error) { console.warn('set_parts upload failed', res.error); return false; }
  return true;
}

// Merge rule (runs once per set per session, when logged in):
// cloud already has rows for the set -> cloud counts win, adopt them.
// cloud has no rows -> push the local counts up.
async function ensureCloudSet(meta) {
  if (!sb || !user) return;
  if (mergedThisSession[meta.set_num]) return;
  // A merge may already be running in the background (openSet starts one).
  // Await that same promise instead of starting a second merge or returning
  // at once on the flag — otherwise a caller that merges on top (the old
  // progress import) can race the late cloud adopt and lose its counts.
  if (cloudMergePromises[meta.set_num]) return cloudMergePromises[meta.set_num];
  cloudMergePromises[meta.set_num] = (async function () {
    mergedThisSession[meta.set_num] = true;
    var ids = cloudIds();
    var userSetId = meta.user_set_id || ids[meta.set_num] || null;
    if (!userSetId) {
      userSetId = await createCloudSet(meta);
      if (!userSetId) return;
      meta.user_set_id = userSetId;
      await uploadAllParts(userSetId, meta.set_num, remainingBySet[meta.set_num] || loadCounts(meta.set_num));
      updateSyncStatus();
      return;
    }
    meta.user_set_id = userSetId;
    var rows = await fetchCloudParts(userSetId);
    if (rows === null) return; // fetch failed: keep local, retry next open
    if (rows.length > 0) {
      var inv = getInventory(meta.set_num);
      var map = {};
      inv.items.forEach(function (it) { map[it.id] = it.qty; });
      var local = remainingBySet[meta.set_num] || loadCounts(meta.set_num);
      // First contact = this device never saved this set's cloud row
      // (no bf:cloudIds entry). Merge best-of-both per lot and push the
      // merged counts back up, so neither device's progress is lost.
      // Already-synced devices keep cloud-wins.
      var firstContact = !ids[meta.set_num];
      rows.forEach(function (r) {
        if (map.hasOwnProperty(r.part_key)) {
          var cloudRem = Math.max(0, r.qty_remaining);
          map[r.part_key] = firstContact
            ? Math.min(cloudRem, (typeof local[r.part_key] === 'number' ? local[r.part_key] : cloudRem))
            : cloudRem;
        }
      });
      remainingBySet[meta.set_num] = map;
      saveCounts(meta.set_num, map);
      if (firstContact) {
        await uploadAllParts(userSetId, meta.set_num, map);
        var ids2 = cloudIds();
        ids2[meta.set_num] = userSetId;
        saveCloudIds(ids2);
      }
    } else {
      await uploadAllParts(userSetId, meta.set_num, remainingBySet[meta.set_num] || loadCounts(meta.set_num));
      var ids3 = cloudIds();
      ids3[meta.set_num] = userSetId;
      saveCloudIds(ids3);
    }
    updateSyncStatus();
  })();
  try { await cloudMergePromises[meta.set_num]; }
  finally { delete cloudMergePromises[meta.set_num]; }
}

// After login: every set known on this device gets a cloud home, and
// the sidebar list becomes the cloud list (union with local).
async function refreshSetsFromCloud() {
  var cloud = await fetchCloudSets();
  var local = localSets();
  var byNum = {};
  cloud.forEach(function (s) { byNum[s.set_num] = s; });
  local.forEach(function (s) { if (!byNum[s.set_num]) byNum[s.set_num] = s; });
  sets = Object.keys(byNum).map(function (k) {
    var m = byNum[k];
    // Cloud rows carry no picture — keep the local one when there is one.
    if (!m.set_img_url) {
      var lm = null;
      local.forEach(function (s) { if (s.set_num === k) lm = s; });
      if (lm && lm.set_img_url) m.set_img_url = lm.set_img_url;
    }
    return m;
  });
  // Create cloud rows for local-only sets (their counts upload on open).
  for (var i = 0; i < sets.length; i++) {
    var s = sets[i];
    if (!s.user_set_id) {
      var id = await createCloudSet(s);
      if (id) s.user_set_id = id;
    }
  }
  saveLocalSets(sets.map(function (s) {
    return { key: s.set_num, set_num: s.set_num, set_name: s.set_name, total_parts: s.total_parts, total_lots: s.total_lots, set_img_url: s.set_img_url || null, user_set_id: s.user_set_id || null };
  }));
  // Inventories for every set in the list, so openSet can use them.
  await loadInventoriesForSets();
  // First-contact sync for every set (merge or upload): the merge must
  // land before any 20s pull can adopt cloud counts over local progress.
  for (var i = 0; i < sets.length; i++) {
    await ensureCloudSet(sets[i]);
  }
}

/* ---------- Live sync (v3.3): other devices, no refresh ----------
 * Pulls only happen on login and set-open (ensureCloudSet) — so a tap
 * on device A would sit invisible on device B until B reloaded. Two
 * mechanisms close that gap:
 *   1. Supabase Realtime: a channel on set_parts + user_sets. Needs
 *      both tables in the `supabase_realtime` publication (migration
 *      20261115_enable_realtime.sql) — without it, the channel
 *      subscribes fine but never delivers an event (silent no-op).
 *   2. Fallback pull: every 20s (and on tab-visible / back-online)
 *      the open sets re-pull their cloud counts.
 * A pull NEVER overwrites a lot this device changed but hasn't synced
 * yet: lots with a pending outbox op keep their local value. Last
 * writer wins only when both devices tapped the same lot while both
 * were online — the later sync lands on top. */
var liveChannel = null;
var pulling = {}; // set_num -> true while a pull for that set is in flight

function pendingOutboxKeys(userSetId) {
  // Lots this device changed but hasn't synced yet. A bulk op (a
  // whole-set upload, e.g. when a set is added) covers every lot, so
  // the whole pull is skipped for that set.
  var keys = {};
  var box = outbox();
  for (var i = 0; i < box.length; i++) {
    var op = box[i];
    if (op.user_set_id !== userSetId) continue;
    if (op.kind === 'bulk') return null;
    if (op.kind === 'part' && op.row && op.row.part_key) keys[op.row.part_key] = true;
  }
  return keys;
}

// Pull one set's cloud counts and adopt them (except pending lots).
// Returns true when something on screen changed.
async function pullRemoteCounts(meta) {
  if (!sb || !user || !meta || !meta.user_set_id) return false;
  if (pulling[meta.set_num]) return false;
  // Don't race the once-per-session cloud merge for the same set.
  if (cloudMergePromises[meta.set_num]) {
    try { await cloudMergePromises[meta.set_num]; } catch (e) { /* fall through */ }
  }
  pulling[meta.set_num] = true;
  try {
    var pending = pendingOutboxKeys(meta.user_set_id);
    if (pending === null) return false; // a bulk sync is queued; it lands shortly
    var rows = await fetchCloudParts(meta.user_set_id);
    if (rows === null) return false;
    var inv = getInventory(meta.set_num);
    if (!inv) return false;
    var current = remainingBySet[meta.set_num] || loadCounts(meta.set_num);
    var map = {};
    inv.items.forEach(function (it) { map[it.id] = it.qty; });
    rows.forEach(function (r) {
      if (map.hasOwnProperty(r.part_key) && !pending[r.part_key]) {
        map[r.part_key] = Math.max(0, r.qty_remaining);
      }
    });
    // Pending lots keep their local (unsynced) value — never the cloud
    // value, and never the full qty the map started with.
    Object.keys(pending).forEach(function (k) {
      if (map.hasOwnProperty(k) && typeof current[k] === 'number') map[k] = current[k];
    });
    var changed = false;
    inv.items.forEach(function (it) {
      if (current[it.id] !== map[it.id]) changed = true;
    });
    if (!changed) return false;
    remainingBySet[meta.set_num] = map;
    saveCounts(meta.set_num, map);
    if (selectedKeys.indexOf(meta.set_num) >= 0) {
      renderSetView();
      renderSets();
    }
    return true;
  } finally {
    delete pulling[meta.set_num];
  }
}

// Pull every set currently on screen.
async function pullSelectedRemote() {
  if (!sb || !user) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  for (var i = 0; i < selectedKeys.length; i++) {
    var meta = findSet(selectedKeys[i]);
    if (meta) await pullRemoteCounts(meta);
  }
}

// Push what's queued, then pull what other devices changed.
async function tickSync() {
  await processOutbox();
  await pullSelectedRemote();
}

// A part row changed somewhere: re-pull that set (the event itself
// carries one row; a full re-pull is cheaper than trusting it, and it
// picks up any other rows that changed with it).
function onRemoteParts(payload) {
  var row = (payload && payload.new) || (payload && payload.old) || {};
  var userSetId = row.user_set_id;
  if (!userSetId) return;
  var meta = null;
  for (var i = 0; i < sets.length; i++) {
    if (sets[i].user_set_id === userSetId) { meta = sets[i]; break; }
  }
  if (meta) pullRemoteCounts(meta);
}

// A set was added or removed somewhere: rebuild the sidebar list.
function onRemoteSets() {
  refreshSetsFromCloud().then(function () {
    renderSets();
    if (activeSetKey && !findSet(activeSetKey)) {
      if (sets.length) openSet(sets[0].key);
      else { activeSetKey = null; showEmpty(); }
    } else if (activeSetKey) {
      renderSetView();
    }
  });
}

function subscribeLive() {
  if (!sb || !user || liveChannel) return;
  try {
    liveChannel = sb.channel('bf-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'set_parts' }, onRemoteParts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_sets' }, onRemoteSets)
      .subscribe();
  } catch (e) {
    liveChannel = null;
  }
}

function unsubscribeLive() {
  if (!liveChannel) return;
  try { if (sb) sb.removeChannel(liveChannel); } catch (e) { /* already gone */ }
  liveChannel = null;
}

/* ---------- Auth ----------
 * Multi-device: Supabase Auth issues a separate session per device
 * (each device keeps its own token in its own localStorage), so two
 * or more devices can be logged in at the same time. Nothing here
 * revokes another device: log out is local-only (signOut defaults
 * to global scope, which would kick every device — we never use it).
 * "Invalid login credentials" is Supabase's wrong-email-or-password
 * error; it is never caused by another device being logged in. */
var pwSetMode = false; // true when the Log in button sets a new password:
// entered from a password-reset link, or from Change password while logged in

// The reset link lands here as #access_token=...&type=recovery. The
// client fires PASSWORD_RECOVERY while it reads that hash — before
// init() has registered its listener — so the event alone can't be
// trusted. Spot the token in the URL at startup instead.
function isRecoveryUrl() {
  try {
    var h = (window.location && window.location.hash) || '';
    return /(^|&)type=recovery(&|$)/.test(h.replace(/^#/, ''));
  } catch (e) { return false; }
}

// Drop the #access_token=... fragment once it's been used, so a reload
// doesn't re-enter recovery mode.
function clearUrlHash() {
  try {
    if (window.history && window.history.replaceState && window.location) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch (e) { /* leaving the hash is harmless */ }
}

// Show the "Set new password" form (used by both the event handler
// and the startup URL check).
function enterRecoveryMode(msg) {
  pwSetMode = true;
  $('authCard').hidden = false;
  renderAuth();
  setAuthMsg(msg || 'Choose a new password, then tap Set new password.', true);
}

function setAuthMsg(msg, ok) {
  var n = $('authMsg');
  n.textContent = msg || '';
  n.className = 'auth-msg' + (ok ? ' ok' : '');
}

// Email as typed on a phone keyboard: trim stray spaces, lowercase
// (a capital letter from autocapitalise must never fail a login).
function authEmail() { return $('authEmail').value.trim().toLowerCase(); }

function authErrorText(err) {
  var m = (err && err.message) || 'Something went wrong signing in.';
  if (/invalid login credentials/i.test(m)) {
    return 'That email and password didn\u2019t match \u2014 check for a typo, a capital letter, or a password your phone filled in for you. Signing in on a second device doesn\u2019t sign the first one out.';
  }
  return m;
}

async function doLogin() {
  if (!sb) { setAuthMsg('Log in needs a connection — try again when you are online.'); return; }
  var email = authEmail();
  var password = $('authPassword').value;
  if (!email || !password) { setAuthMsg('Enter an email and password.'); return; }
  if (pwSetMode) {
    // Came in from a password-reset email or Change password: set the new password.
    setAuthMsg('Setting your new password…', true);
    var upd = await sb.auth.updateUser({ password: password });
    if (upd.error) { setAuthMsg(authErrorText(upd.error)); return; }
    pwSetMode = false;
    clearUrlHash();
    renderAuth();
    setAuthMsg('Password updated — logged in.', true);
    return;
  }
  setAuthMsg('Logging in…', true);
  var res = await sb.auth.signInWithPassword({ email: email, password: password });
  if (res.error) setAuthMsg(authErrorText(res.error));
  else setAuthMsg('Logged in.', true);
}

async function doSignup() {
  if (!sb) { setAuthMsg('Sign up needs a connection — try again when you are online.'); return; }
  var email = authEmail();
  var password = $('authPassword').value;
  if (!email || !password) { setAuthMsg('Enter an email and password.'); return; }
  if (password.length < 6) { setAuthMsg('Password needs at least 6 characters.'); return; }
  setAuthMsg('Creating your account…', true);
  var res = await sb.auth.signUp({ email: email, password: password });
  if (res.error) { setAuthMsg(authErrorText(res.error)); return; }
  if (res.data && res.data.session) {
    setAuthMsg('Account created — logged in.', true);
  } else {
    // Email confirmation is on: no session until they confirm.
    setAuthMsg('Check your email to confirm your account, then log in.', true);
  }
}

// "Change password" (logged in): set a new password right here, no
// email involved — the bypass when the reset-email budget is spent.
function startChangePassword() {
  if (!user) return;
  $('authPassword').value = '';
  enterRecoveryMode('Choose a new password, then tap Set new password.');
}

// "Forgot password?" — emails a reset link that opens this app;
// the link fires a PASSWORD_RECOVERY event (see handleAuthChange),
// which turns the log-in button into "Set new password".
async function doForgotPassword() {
  if (!sb) { setAuthMsg('Password reset needs a connection — try again when you are online.'); return; }
  var email = authEmail();
  if (!email) { setAuthMsg('Type your email above first, then tap Forgot password?'); return; }
  setAuthMsg('Sending a reset link…', true);
  var opts = {};
  if (typeof window !== 'undefined' && window.location && window.location.href) {
    opts.redirectTo = window.location.href.split('#')[0];
  }
  var res = await sb.auth.resetPasswordForEmail(email, opts);
  if (res.error) setAuthMsg(authErrorText(res.error));
  else setAuthMsg('Reset link sent to ' + email + ' — check your email.', true);
}

function applyLoggedOutUI() {
  user = null;
  mergedThisSession = {};
  sets = localSets();
  renderAuth();
  renderSets();
  if (activeSetKey && sets.some(function (s) { return s.key === activeSetKey; })) {
    openSet(activeSetKey);
  } else {
    activeSetKey = null;
    showEmpty();
  }
  updateSyncStatus();
}

async function doLogout() {
  unsubscribeLive();
  // Local scope only: logging out on this device must NOT sign out
  // the user's other devices (the default global scope would).
  if (sb) await sb.auth.signOut({ scope: 'local' });
  applyLoggedOutUI();
}

async function handleAuthChange(event, session) {
  if (event === 'PASSWORD_RECOVERY') {
    // Opened a reset link: the log-in button becomes "Set new password".
    user = (session && session.user) ? session.user : user;
    enterRecoveryMode();
    return;
  }
  user = (session && session.user) ? session.user : null;
  if (!user) {
    // Signed out on this device (or the session expired): drop the
    // live listener and show the logged-out UI.
    unsubscribeLive();
    applyLoggedOutUI();
    return;
  }
  subscribeLive();
  await refreshSetsFromCloud();
  renderAuth();
  renderSets();
  // Keep whatever view is already open. init() restored it (same-day
  // filters + selection, or a new day's Still-needed + all sets), and a
  // sign-in / session-restore fires after init — it must not collapse
  // a combined view to one set. If init hasn't restored yet, it will
  // do so in a moment, so open nothing here either. Only open a set
  // when init is done and nothing is open.
  if (viewRestored) {
    if (!selectedKeys.length) {
      if (activeSetKey) openSet(activeSetKey);
      else if (sets.length) openSet(sets[0].key);
    } else {
      loadSelected(); // re-render with the merged cloud counts
    }
  }
  updateSyncStatus();
}

function renderAuth() {
  var card = $('authCard');
  var toggle = $('authToggleBtn');
  var logout = $('logoutBtn');
  var chip = $('userChip');
  var loginBtn = $('loginBtn');
  var signupBtn = $('signupBtn');
  var forgotBtn = $('forgotBtn');
  var changePwBtn = $('changePwBtn');
  if (pwSetMode) {
    card.hidden = false;
    toggle.hidden = true;
    logout.hidden = true;
    chip.hidden = true;
    changePwBtn.hidden = true;
    loginBtn.textContent = 'Set new password';
    signupBtn.hidden = true;
    forgotBtn.hidden = true;
    return;
  }
  loginBtn.textContent = 'Log in';
  signupBtn.hidden = false;
  forgotBtn.hidden = false;
  if (user) {
    card.hidden = true;
    toggle.hidden = true;
    logout.hidden = false;
    chip.hidden = false;
    changePwBtn.hidden = false;
    chip.textContent = user.email || 'Logged in';
  } else {
    toggle.hidden = false;
    logout.hidden = true;
    chip.hidden = true;
    changePwBtn.hidden = true;
    card.hidden = !!LS.get('bf:guestDismissed', false);
  }
}

/* ---------- Sets: add / open ---------- */
function findSet(key) {
  for (var i = 0; i < sets.length; i++) if (sets[i].key === key) return sets[i];
  return null;
}

async function addSeedSet() {
  if (findSet(SEED_SET.key)) { openSet(SEED_SET.key); return; }
  var meta = {
    key: SEED_SET.key, set_num: SEED_SET.set_num, set_name: SEED_SET.set_name,
    total_parts: SEED_SET.total_parts, total_lots: SEED_SET.total_lots,
    set_img_url: SEED_SET.set_img_url, user_set_id: null
  };
  // Local record first (guest or logged in — device copy always exists).
  var local = localSets();
  local.push(meta);
  saveLocalSets(local);
  sets.push(meta);
  // Start at full qty.
  var inv = getInventory(meta.set_num);
  var map = {};
  inv.items.forEach(function (it) { map[it.id] = it.qty; });
  saveCounts(meta.set_num, map);
  if (user && sb) {
    var id = await createCloudSet(meta);
    if (id) {
      meta.user_set_id = id;
      await uploadAllParts(id, meta.set_num, map);
    }
  }
  renderSets();
  openSet(meta.key);
}

// One-time import of the 8961-1 progress from the old Muse-hosted tracker
// (snapshot above: 340 of 430 found). Merge rule: only ever ADDS found
// pieces — remaining = min(current, imported). Tapping twice is a no-op.
// Requires login: the import writes to the user's Supabase account.
/* One-time import: once the old progress is in, the import buttons go
 * away — Joseph is the only person who will ever import it. Stored on this
 * device; tapping import again is a harmless no-op that also sets the flag,
 * so an import done before this version hides the buttons on the next tap. */
function importDoneFlag(setNum) { return LS.get('bf:imported:' + setNum, null) === '1'; }
function markImported(setNum) { LS.set('bf:imported:' + setNum, '1'); }
function refreshImportButtons() {
  var done = importDoneFlag('8961-1');
  var wrap = $('importSeedWrap');
  if (wrap) wrap.style.display = (findSet('8961-1') || done) ? 'none' : '';
  var btn = $('importBtn');
  if (btn) btn.style.display = done ? 'none' : '';
}

async function importOldProgress() {
  var msg = $('importMsg');
  var side = $('addSetMsg');
  function say(t) {
    if (msg) msg.textContent = t;
    if (side) side.textContent = t;
  }
  if (!sb || !user) { say('Log in first — the import saves to your Supabase account.'); return; }
  var imported = {};
  INVENTORY_8961.items.forEach(function (it) {
    imported[it.id] = (typeof IMPORT_8961_PROGRESS[it.id] === 'number')
      ? Math.max(0, Math.min(it.qty, IMPORT_8961_PROGRESS[it.id])) : it.qty;
  });
  var meta = findSet('8961-1');
  if (!meta) {
    // No set yet: seed it already carrying the imported counts.
    meta = { key: '8961-1', set_num: '8961-1', set_name: 'Crystal Sweeper', total_parts: 430, total_lots: 138, user_set_id: null };
    var local = localSets();
    local.push(meta);
    saveLocalSets(local);
    sets.push(meta);
    saveCounts(meta.set_num, imported);
    markImported('8961-1');
    var id = await createCloudSet(meta);
    if (id) {
      meta.user_set_id = id;
      await uploadAllParts(id, meta.set_num, imported);
    }
    // If the cloud set failed, the local copy stays; it uploads on next open.
    openSet(meta.key);
    var t0 = totals();
    say('Imported your old progress — ' + t0.found + ' of ' + t0.total + ' found.');
    updateSyncStatus();
    return;
  }
  // Set exists: open it (cloud merge settles first), then merge on top.
  openSet('8961-1');
  await ensureCloudSet(meta);
  var map = remainingBySet['8961-1'];
  var added = 0;
  getInventory('8961-1').items.forEach(function (it) {
    var cur = (map[it.id] === undefined) ? it.qty : map[it.id];
    var next = Math.min(cur, imported[it.id]);
    if (next < cur) { map[it.id] = next; added += (cur - next); }
  });
  saveCounts(meta.set_num, map);
  markImported('8961-1');
  renderSetView();
  if (meta.user_set_id) enqueueBulkSync(meta);
  var t = totals();
  say(added > 0
    ? 'Imported ' + added + ' found pieces from your old tracker — now ' + t.found + ' of ' + t.total + ' found.'
    : 'Already up to date — ' + t.found + ' of ' + t.total + ' found.');
  updateSyncStatus();
}


/* ---------- Add a set by number (Rebrickable lookup) ---------- */
// The number the user typed, with "-1" assumed when no variant is given
// (mirrors the import-set function, which does the same).
function normalizeSetNumInput(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  return s.indexOf('-') >= 0 ? s : s + '-1';
}

var pendingImport = null; // { set_num, name, year, num_parts, set_img_url, inventory, lots, pieces, cached }

// The import-set function answers with { ok, cached, set, inventory, ... }
// or { ok:false, error, message }. supabase-js may put the error body in
// data or in error.context depending on the status — check both.
function importErrorText(res) {
  var payload = (res && res.data) || null;
  var ctx = (res && res.error && res.error.context) || null;
  var body = payload || ctx;
  if (body && body.message) return body.message;
  var code = body && body.error;
  if (code === 'set_not_found') return 'Rebrickable has no set with that number — check it and try again.';
  if (code === 'no_api_key') return 'The Rebrickable key is not set up yet — add it in Supabase and try again.';
  if (code === 'rate_limited') return 'Rebrickable is busy right now — wait a minute and try again.';
  if (code === 'unauthorized') return 'Log in first — adding a set saves it to your account.';
  if (res && res.error && res.error.message) return res.error.message;
  return 'Lookup failed — try again.';
}

function showAddSetPreview(p) {
  var wrap = $('addSetPreview');
  if (!wrap) return;
  var img = $('addSetPreviewImg');
  if (img) img.src = p.set_img_url || '';
  var name = $('addSetPreviewName');
  if (name) name.textContent = p.set_num + ' — ' + p.name;
  var meta = $('addSetPreviewMeta');
  if (meta) meta.textContent = (p.year ? p.year + ' · ' : '') + p.lots + ' lots, ' + p.pieces + ' pieces' + (p.cached ? ' · imported before' : '');
  wrap.hidden = false;
}

function hideAddSetPreview() {
  var wrap = $('addSetPreview');
  if (wrap) wrap.hidden = true;
  pendingImport = null;
}

function showAddSetResults(results) {
  var wrap = $('addSetResults');
  if (!wrap) return;
  wrap.innerHTML = '';
  results.forEach(function (r) {
    var row = el('button', 'add-set-result');
    row.type = 'button';
    if (r.set_img_url) {
      var img = document.createElement('img');
      img.className = 'add-set-result-img';
      img.src = r.set_img_url;
      img.alt = '';
      img.addEventListener('error', function () { img.style.display = 'none'; });
      row.appendChild(img);
    }
    var text = el('div', 'add-set-result-text');
    text.appendChild(el('div', 'set-name', r.name));
    text.appendChild(el('div', 'set-num', r.set_num + (r.year ? ' · ' + r.year : '') + (r.num_parts ? ' · ' + r.num_parts + ' pieces' : '')));
    row.appendChild(text);
    row.addEventListener('click', function () {
      hideAddSetResults();
      $('setNumInput').value = r.set_num;
      lookupSet();
    });
    wrap.appendChild(row);
  });
  wrap.hidden = false;
}

function hideAddSetResults() {
  var wrap = $('addSetResults');
  if (wrap) { wrap.hidden = true; wrap.innerHTML = ''; }
}

async function lookupSet() {
  var msg = $('addSetMsg');
  function say(t) { if (msg) msg.textContent = t; }
  var raw = $('setNumInput').value.trim();
  if (!raw) { say('Type a set number or name first — e.g. 10294-1 or Crystal King.'); return; }
  if (!sb || !user) { say('Log in first — adding a set saves it to your account.'); return; }
  hideAddSetPreview();
  hideAddSetResults();
  if (!/^\d+(-\d+)?$/.test(raw)) {
    // Name search: "Crystal Sweeper", "Crystal King", ...
    say('Searching for "' + raw + '"…');
    var res2;
    try {
      res2 = await sb.functions.invoke('import-set', { body: { q: raw } });
    } catch (e) {
      say('Search failed — check your connection and try again.');
      return;
    }
    var payload2 = (res2 && res2.data) || null;
    if (!payload2 || !payload2.ok) {
      say(importErrorText(res2));
      return;
    }
    var results = payload2.results || [];
    if (!results.length) {
      say('No sets matched "' + raw + '" — check the spelling, or try the set number.');
      return;
    }
    showAddSetResults(results);
    say(results.length + (results.length === 1 ? ' match' : ' matches') + ' — tap one to look it up.');
    return;
  }
  var num = normalizeSetNumInput(raw);
  if (findSet(num)) { say('That set is already in your list — open it from the sidebar.'); return; }
  say('Looking up ' + num + '…');
  var res;
  try {
    res = await sb.functions.invoke('import-set', { body: { set_num: num } });
  } catch (e) {
    say('Lookup failed — check your connection and try again.');
    return;
  }
  var payload = (res && res.data) || null;
  if (!payload || !payload.ok) {
    say(importErrorText(res));
    return;
  }
  pendingImport = {
    set_num: payload.set.set_num, name: payload.set.name, year: payload.set.year,
    num_parts: payload.set.num_parts, set_img_url: payload.set.set_img_url,
    inventory: payload.inventory, lots: payload.lots, pieces: payload.pieces,
    cached: !!payload.cached
  };
  showAddSetPreview(pendingImport);
  say('Found it — tap "Add this set" to put it in your list.');
}

async function addImportedSet() {
  var p = pendingImport;
  if (!p) return;
  var msg = $('addSetMsg');
  function say(t) { if (msg) msg.textContent = t; }
  // Register the inventory first: loadCounts/openSet need it right away.
  INVENTORIES[p.set_num] = p.inventory;
  var meta = {
    key: p.set_num, set_num: p.set_num, set_name: p.name,
    total_parts: p.inventory.pieces, total_lots: p.inventory.lots,
    set_img_url: p.set_img_url, user_set_id: null
  };
  var local = localSets();
  local.push(meta);
  saveLocalSets(local);
  sets.push(meta);
  var map = {};
  p.inventory.items.forEach(function (it) { map[it.id] = it.qty; });
  saveCounts(p.set_num, map);
  var cloudSaved = true;
  if (user && sb) {
    var id = await createCloudSet(meta);
    if (id) {
      meta.user_set_id = id;
      cloudSaved = await uploadAllParts(id, p.set_num, map);
    } else {
      cloudSaved = false;
    }
    // If the cloud save failed, the local copy stays; it uploads on next open.
  }
  hideAddSetPreview();
  $('setNumInput').value = '';
  renderSets();
  openSet(meta.key);
  say(cloudSaved
    ? 'Added ' + p.set_num + ' — ' + p.inventory.lots + ' lots, ' + p.inventory.pieces + ' pieces. All lots start at full count.'
    : 'Added ' + p.set_num + ' on this device, but the cloud save failed — it is not on your other devices yet. Reopen the set to retry.');
  updateSyncStatus();
}


// The sets the combined view shows. Saved on this device.
function loadSelectedKeys() { return LS.get('bf:selectedSets', null); }
function saveSelectedKeys() { LS.set('bf:selectedSets', selectedKeys); }

// Rebuild the combined view from selectedKeys: per-set counts + items
// tagged with their set (copies — the shared inventory is never mutated).
// ---------- tiers for imported sets (v3.18) ----------
// 8961-1 carries hand-audited tiers (his v2.1 audit). Every set that
// arrives through the import function stores tier 2 on every lot —
// there is no bulk-likelihood data for a new set — so on its own the
// three-tier system vanished for 8960-1/8962-1: one big Tier 2 list,
// no Tier 1, no Tier 3. These rules re-tier those sets at load time,
// fitted against his 8961-1 audit (86% of its 138 lots agree; the
// only tier-3 misses are two one-off parts, 64713 and 2634, that no
// category rule catches). Tier 3 = the parts that are rare by
// identity: the crystal/rock-monster parts, minifig heads, torsos and
// legs, the part numbers he already called tier 3 in the audit (they
// stay tier 3 in any set), stickers, constraction parts, and the
// one-off categories that never show up in bulk. Tier 1 = the plain
// bulk-bin workhorses. Everything else stays Tier 2. A set is only
// re-tiered when it has no real tiers at all (every lot tier 2);
// 8961-1's hand tiers are never touched.
var TIER3_PARTS = {
  '64786': 1, '64881': 1, '64882': 1, '76382': 1, '85107': 1,
  '32018': 1, '64450': 1, '3837': 1, '73587': 1, '30300': 1,
  '48169': 1, '48171': 1, '41669': 1
};
var TIER3_CATS = { 'Stickers': 1, 'Transportation - Land': 1 };
var TIER1_CATS = {
  'Bricks': 1, 'Plates': 1, 'Sloped Bricks': 1, 'Small pieces': 1,
  'Technic Pins / Bushes': 1, 'Technic Axles': 1
};
var TIER1_COLOURS = {
  'Black': 1, 'White': 1, 'Dark Grey': 1, 'Light Grey': 1, 'Red': 1,
  'Blue': 1, 'Yellow': 1, 'Tan': 1, 'Orange': 1, 'Lime Green': 1, '': 1
};
function deriveTier(item) {
  var pn = partNumOf(item);
  if (TIER3_PARTS[pn]) return 3;
  var cat = item.cat || '';
  if (cat.indexOf('Bionicle') === 0) return 3;
  if (TIER3_CATS[cat]) return 3;
  if (TIER1_CATS[cat] && TIER1_COLOURS[item.colour || '']) return 1;
  return 2;
}
function inventoryHasRealTiers(inv) {
  if (!inv || !inv.items || !inv.items.length) return false;
  return inv.items.some(function (it) { return it.tier === 1 || it.tier === 3; });
}

function loadSelected() {
  items = [];
  remainingBySet = {};
  selectedKeys.forEach(function (key) {
    var inv = getInventory(key);
    if (!inv) return;
    remainingBySet[key] = loadCounts(key);
    var reTier = !inventoryHasRealTiers(inv);
    inv.items.forEach(function (it) {
      var copy = {};
      for (var k in it) copy[k] = it[k];
      copy.setKey = key;
      if (reTier) copy.tier = deriveTier(it);
      items.push(copy);
    });
  });
  rebuildCatCounts();
  $('emptyState').hidden = items.length > 0;
  $('progressWrap').hidden = items.length === 0;
  renderSets();
  renderSetView();
  renderSetPicker();
}

/* ---------- Mobile drawer: the sidebar slides out from the left ----------
 * Desktop: the hamburger is hidden and the sidebar is always visible.
 * Phone: the hamburger in the header opens it; picking a set, tapping
 * the backdrop, or Escape closes it. */
function setDrawer(open) {
  document.body.classList.toggle('drawer-open', open);
  $('menuBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
}
function toggleDrawer() { setDrawer(!document.body.classList.contains('drawer-open')); }
function closeDrawer() { setDrawer(false); }

// Pick exactly these sets (at least one) and show them together.
function setSelected(keys) {
  var valid = keys.filter(function (k) { return findSet(k); });
  if (!valid.length) return;
  selectedKeys = valid;
  saveSelectedKeys();
  saveViewState();
  loadSelected();
}

// Picker toggle for one set. The last selected set stays checked —
// the view always shows at least one set.
function toggleSet(key) {
  var i = selectedKeys.indexOf(key);
  if (i >= 0) {
    if (selectedKeys.length === 1) return;
    selectedKeys.splice(i, 1);
  } else {
    selectedKeys.push(key);
  }
  saveSelectedKeys();
  saveViewState();
  loadSelected();
}

// The "Select all" box: check -> every set; uncheck -> just the first set.
function selectAllSets(select) {
  if (select) {
    selectedKeys = sets.map(function (s) { return s.key; });
  } else {
    selectedKeys = [sets.length ? sets[0].key : activeSetKey].filter(Boolean);
  }
  saveSelectedKeys();
  saveViewState();
  loadSelected();
}

// Sidebar click: show just this set. The picker can add more sets on top.
function openSet(key) {
  var meta = findSet(key);
  if (!meta) return;
  closeDrawer();
  activeSetKey = key;
  LS.set('bf:activeSet', key);
  setSelected([key]);
  var im = $('importMsg'); if (im) im.textContent = '';
  if (user && sb) {
    // Cloud merge in the background; re-render if it changed counts.
    ensureCloudSet(meta).then(function () { renderSetView(); updateSyncStatus(); });
  }
  updateSyncStatus();
  start3DPreload(key);
}

function showEmpty() {
  $('progressWrap').hidden = true;
  $('setView').innerHTML = '';
  $('emptyState').hidden = false;
}

/* ---------- Set view: grid, filters, counters ---------- */
function setTitle() {
  if (selectedKeys.length === 1) {
    var meta = findSet(selectedKeys[0]);
    return meta ? meta.set_num + ' — ' + meta.set_name : '';
  }
  return selectedKeys.length + ' sets — ' + selectedKeys.join(', ');
}

function totals() {
  var found = 0, done = 0;
  items.forEach(function (it) {
    var rem = remOf(it);
    found += (it.qty - rem);
    if (rem === 0) done++;
  });
  return { found: found, total: items.reduce(function (a, it) { return a + it.qty; }, 0), done: done, lots: items.length };
}

function cardMatches(item) {
  var rem = remOf(item);
  if (statusFilter === 'needed' && rem === 0) return false;
  if (statusFilter === 'done' && rem !== 0) return false;
  if (colourFilter !== 'all' && familyOf(item) !== colourFilter) return false;
  if (typeFilter !== 'all' && displayCat(item) !== typeFilter) return false;
  return true;
}

function rebuildColourSelect() {
  var sel = $('colourSelect');
  if (!sel) return;
  var current = colourFilter || 'all'; // the filter variable is the source of truth
  // Remaining pieces per family (trans variants folded into base colours;
  // lots that used to be "any colour" count under their pictured colour).
  var famLeft = {};
  items.forEach(function (it) {
    var rem = remOf(it);
    var fam = familyOf(it);
    famLeft[fam] = (famLeft[fam] || 0) + rem;
  });
  // A colour with nothing left to find gets no entry at all.
  var fams = Object.keys(famLeft).filter(function (f) { return famLeft[f] > 0; }).sort(function (a, b) {
    if (famLeft[b] !== famLeft[a]) return famLeft[b] - famLeft[a];
    return a < b ? -1 : 1;
  });
  sel.innerHTML = '';
  var optAll = el('option', null, 'All colours');
  optAll.value = 'all';
  sel.appendChild(optAll);
  fams.forEach(function (fam) {
    var o = el('option', null, fam + ' · ' + famLeft[fam] + ' left');
    o.value = fam;
    sel.appendChild(o);
  });
  // Keep the previous selection if it still exists.
  sel.value = (current === 'all' || (famLeft[current] || 0) > 0) ? current : 'all';
  colourFilter = sel.value;
}

function rebuildTypeSelect() {
  var sel = $('typeSelect');
  if (!sel) return;
  var current = typeFilter || 'all'; // the filter variable is the source of truth
  rebuildCatCounts(); // the fold follows what is left, so refresh it here too
  // Remaining pieces per displayed category — small raw categories fold
  // into Miscellaneous (see displayCat), from the lots actually here.
  var catLeft = {};
  items.forEach(function (it) {
    var rem = remOf(it);
    var c = displayCat(it);
    catLeft[c] = (catLeft[c] || 0) + rem;
  });
  // A category with nothing left to find gets no entry at all.
  var cats = Object.keys(catLeft).filter(function (c) { return catLeft[c] > 0; }).sort(function (a, b) {
    if (catLeft[b] !== catLeft[a]) return catLeft[b] - catLeft[a];
    return a < b ? -1 : 1;
  });
  sel.innerHTML = '';
  var optAll = el('option', null, 'All types');
  optAll.value = 'all';
  sel.appendChild(optAll);
  cats.forEach(function (c) {
    var o = el('option', null, c + ' \u00b7 ' + catLeft[c] + ' left');
    o.value = c;
    sel.appendChild(o);
  });
  // Keep the previous selection if it still exists.
  sel.value = (current === 'all' || (catLeft[current] || 0) > 0) ? current : 'all';
  typeFilter = sel.value;
}

function renderProgress() {
  var t = totals();
  $('progressFound').textContent = t.found + ' of ' + t.total + ' found';
  $('progressLots').textContent = t.done + ' of ' + t.lots + ' lots done';
  $('progressFill').style.width = (t.total ? Math.round(100 * t.found / t.total) : 0) + '%';
}

function renderSetView() {
  var view = $('setView');
  view.innerHTML = '';
  if (!selectedKeys.length || !items.length) { showEmpty(); return; }
  $('emptyState').hidden = true;
  $('progressWrap').hidden = false;

  var h = el('h2', null, setTitle());
  h.style.margin = '4px 0 12px';
  view.appendChild(h);

  var tierNotes = {
    1: 'Common bricks and plates — the bulk bins are full of these.',
    2: 'Worth digging for — less common, still in the bins.',
    3: 'Rare in bulk — check the sorted cases and minifig wall too.'
  };

  var shown = 0;
  // Tier names are the same across sets; take them from the first set
  // that has an inventory, so a combined view still names each tier once.
  var tierNames = { 1: 'MOST LIKELY IN BULK', 2: 'MEDIUM — WORTH A DIG', 3: 'LEAST LIKELY IN BULK' };
  selectedKeys.forEach(function (key) {
    var inv = getInventory(key);
    if (inv && inv.tiers) tierNames = inv.tiers;
  });
  function appendTier(tier, tierItems) {
    if (!tierItems.length) return;
    shown++;
    var banner = el('h3', 'tier-banner tier-' + tier, 'TIER ' + tier + ' — ' + tierNames[String(tier)]);
    view.appendChild(banner);
    view.appendChild(el('p', 'tier-note', tierNotes[tier]));
    var grid = el('div', 'card-grid');
    tierItems.forEach(function (it) { grid.appendChild(buildCard(it)); });
    view.appendChild(grid);
  }
  if (selectedKeys.length > 1) {
    // Several sets open: one banner per tier across ALL sets, so TIER 2
    // never repeats after TIER 3. Cards carry no set tag — in a combined
    // view the set a part came from is needless information.
    [1, 2, 3].forEach(function (tier) {
      appendTier(tier, items.filter(function (it) { return it.tier === tier && cardMatches(it); }));
    });
  } else {
    selectedKeys.forEach(function (key) {
      var setItems = items.filter(function (it) { return it.setKey === key; });
      if (!setItems.length) return;
      [1, 2, 3].forEach(function (tier) {
        appendTier(tier, setItems.filter(function (it) { return it.tier === tier && cardMatches(it); }));
      });
    });
  }
  if (!shown) view.appendChild(el('p', 'muted', 'No pieces match these filters — try widening the type or colour.'));

  var impBtn = $('importBtn');
  if (impBtn) impBtn.hidden = selectedKeys.indexOf('8961-1') < 0;
  rebuildColourSelect();
  rebuildTypeSelect();
  renderProgress();
  renderSets(); // sidebar progress numbers
}

// BrickLink colour ids for the display colours (from Rebrickable's
// colour table — the BrickLink column). Used for the photo fallback:
// when the primary image is dead, try BrickLink's photo of the same
// part in the same colour. The colour here is the lot's exact colour
// (item.colour), NOT the folded family — Trans-Red is 17, Red is 5.
var BRICKLINK_COLOUR = {
  'White': 1, 'Black': 11, 'Blue': 7, 'Red': 5, 'Dark Grey': 85,
  'Light Grey': 86, 'Tan': 2, 'Orange': 4, 'Yellow': 3, 'Lime Green': 34,
  'Clear': 12, 'Trans-Blue': 14, 'Trans-Brown': 13, 'Trans-Green': 20,
  'Trans-Orange': 98, 'Trans-Red': 17
};

// The alternate photo for a card whose primary image is dead.
// Sticker sheets live on BrickLink under the set's sheet number
// (8960stk01), not the LEGO part number; everything else uses the
// part number in the lot's colour. Returns '' when there is no
// alternate to try (unknown colour).
function fallbackImg(item) {
  if (item.cat === 'Stickers') {
    return 'https://img.bricklink.com/ItemImage/PN/0/' + String(item.setKey || '').split('-')[0] + 'stk01.png';
  }
  var bl = BRICKLINK_COLOUR[item.colour];
  if (bl === undefined) return '';
  return 'https://img.bricklink.com/ItemImage/PN/' + bl + '/' + partNumOf(item) + '.png';
}

// LDraw colour codes for the display colours (from the LDraw library's
// own colour table, ldcfgalt.ldr — the file the 3D loader reads, so
// these are the codes the loader accepts). These are NOT the
// Rebrickable ids: Trans-Orange is 57 here, not Rebrickable 182; the
// greys are the bluish greys, 71/72; Trans-Brown is LDraw's
// Trans_Black (40). Unknown colours fall back to dark grey (72) — the
// shape is what matters for an any-colour lot.
var LDRAW_COLOUR = {
  'White': 15, 'Black': 0, 'Blue': 1, 'Red': 4, 'Dark Grey': 72,
  'Light Grey': 71, 'Tan': 19, 'Orange': 25, 'Yellow': 14, 'Lime Green': 27,
  'Clear': 47, 'Trans-Blue': 33, 'Trans-Brown': 40, 'Trans-Green': 34,
  'Trans-Orange': 57, 'Trans-Red': 36
};

// ---------- 3D part viewer (v3.15) ----------
// Tap a card photo and the part pops up as a live 3D model — drag to
// spin it, scroll or pinch to zoom, Top / Front / Side / Underside
// buttons for the flat views. No carousel: the photo on the card is
// the reference, the popup is the model. The model itself lives in
// model3d.js (Three.js + LDrawLoader); this file only asks for it, so
// the harness can stub show3DModel/hide3DModel without WebGL.
var viewerItem = null; // the lot the popup is showing
var viewerPart = null; // the part number the model was asked for
var viewerColourCode = null; // the LDraw code the model was asked for
var viewer3DTimeout = null;

// The phone back button (v3.18): opening the 3D view pushes a
// history entry, so Back closes the view instead of leaving the site.
// Closing with X / tap-outside / Escape pops that entry back off
// (history.back), and a popstate while the view is open closes it.
var viewerHistoryPushed = false;
function openViewer(item) {
  viewerItem = item;
  $('lightboxLabel').textContent = 'Part ' + partNumOf(item) + ' — ' + displayColour(item);
  $('lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
  if (typeof window !== 'undefined' && window.history && window.history.pushState) {
    try { window.history.pushState({ bf3d: true }, ''); viewerHistoryPushed = true; } catch (e) { viewerHistoryPushed = false; }
  }
  show3DModel(item);
}

function show3DModel(item) {
  var part = partNumOf(item);
  var code = LDRAW_COLOUR[item.colour];
  if (code === undefined) code = 72; // any-colour lot: shape matters, not shade
  viewerPart = part;
  viewerColourCode = code;
  var statusEl = $('model3dStatus');
  if (statusEl) statusEl.textContent = 'Loading 3D viewer…';
  // The photo rides along so a part with no 3D model can show its
  // picture big in the popup instead (v3.21) — primary photo first,
  // BrickLink's photo of the same part+colour if that one is dead.
  var photo = item.img || '';
  var photoFallback = fallbackImg(item);
  // The element id (first field of the item id) rides along too: the
  // print belongs to the element, not the design number (v3.23) — the
  // two 76382 torsos wear different prints, 973pau vs 973pas.
  var element = (item.id || '').split('-')[0];
  if (typeof window !== 'undefined' && window.BulkFinder3D) {
    window.BulkFinder3D.show(part, code, photo, photoFallback, element);
    return;
  }
  if (typeof window === 'undefined') return;
  // The 3D module loads in the background; it picks this up when ready.
  window.__bfPending3D = { part: part, colour: code, img: photo, fallback: photoFallback, element: element };
  if (viewer3DTimeout) clearTimeout(viewer3DTimeout);
  viewer3DTimeout = setTimeout(function () {
    if (!window.BulkFinder3D && viewerItem === item && statusEl) {
      statusEl.textContent = '3D viewer still loading — check connection and tap the photo again.';
    }
  }, 8000);
}

function hide3DModel() {
  if (typeof window !== 'undefined') window.__bfPending3D = null;
  if (viewer3DTimeout) { clearTimeout(viewer3DTimeout); viewer3DTimeout = null; }
  if (typeof window !== 'undefined' && window.BulkFinder3D) window.BulkFinder3D.hide();
}

/* ---------- Instructions viewer (v3.22) ---------- */
// The viewer itself lives in instructions.js (pdf.js rendering, lazy
// pages, scroll resume). It loads in the background; if a set is tapped
// before it arrives, the request waits in window.__bfPendingInstr and
// the module picks it up on load.
// Scroll position, per set — the viewer restores it on reopen.
function instrPosKey(setNum) { return 'bf:instrPos:' + setNum; }
// A LEGO instruction PDF, through the get-instructions proxy (LEGO's
// CDN blocks direct browser fetches and framing — see that function).
function instrPdfUrl(legoUrl) {
  return SUPABASE_URL + '/functions/v1/get-instructions?pdf=' + encodeURIComponent(legoUrl);
}
// LEGO's own instructions page for a set — the fallback when the
// in-app viewer can't load the PDFs.
function legoInstructionsUrl(setNum) {
  return 'https://www.lego.com/en-us/service/building-instructions/' + setNum;
}
function openInstructions(setNum, setName) {
  if (typeof window !== 'undefined' && window.BulkFinderInstructions) {
    window.BulkFinderInstructions.open(setNum, setName || setNum);
    return;
  }
  if (typeof window === 'undefined') return;
  window.__bfPendingInstr = { set: setNum, name: setName || setNum };
}

function closeViewer() {
  viewerItem = null;
  viewerPart = null;
  viewerColourCode = null;
  hide3DModel();
  $('lightbox').hidden = true;
  document.body.style.overflow = '';
  if (viewerHistoryPushed) {
    viewerHistoryPushed = false;
    if (typeof window !== 'undefined' && window.history && window.history.back) {
      try { window.history.back(); } catch (e) {}
    }
  }
}

// ---------- background 3D preload (v3.16) ----------
// After a set is added, its parts' geometry downloads in the
// background so tapping a photo is instant later — the parts list
// shows at once and the 3D catches up behind it. The geometry is the
// public LDraw library (the same file for everyone), so it is cached
// in this browser, not uploaded to the account; the account holds the
// set and the counts. Progress is kept per device in bf:3dready so a
// refresh resumes where it left off instead of starting over.
var pendingPreloadSets = []; // set keys waiting on the 3D module to load

function ready3DKeys(setKey) {
  var all = LS.get('bf:3dready', {}) || {};
  return all[setKey] || [];
}

function mark3DReady(setKey, key) {
  var all = LS.get('bf:3dready', {}) || {};
  var list = all[setKey] || [];
  if (list.indexOf(key) === -1) {
    list.push(key);
    all[setKey] = list;
    LS.set('bf:3dready', all);
  }
}

function start3DPreload(setKey) {
  var inv = INVENTORIES[setKey];
  if (!inv || !inv.items) return;
  var ready = {};
  ready3DKeys(setKey).forEach(function (k) { ready[k] = true; });
  var items = [];
  var seen = {};
  inv.items.forEach(function (it) {
    var part = partNumOf(it);
    var code = LDRAW_COLOUR[it.colour];
    if (code === undefined) code = 72; // any-colour lot: shape matters, not shade
    var key = part + ':' + code;
    if (seen[key] || ready[key]) return;
    seen[key] = true;
    // The element rides along so the background download fetches the
    // printed file (973pau/973pas) for the torsos, not the plain one.
    items.push({ part: part, colour: code, key: key, setKey: setKey, element: (it.id || '').split('-')[0] });
  });
  if (!items.length) { updatePreloadStatus(); return; }
  if (typeof window === 'undefined' || !window.BulkFinder3D || !window.BulkFinder3D.queuePreload) {
    // The 3D module loads after this file; it fires bf3dready when it
    // arrives, and the listener below flushes these.
    if (pendingPreloadSets.indexOf(setKey) === -1) pendingPreloadSets.push(setKey);
    updatePreloadStatus();
    return;
  }
  window.BulkFinder3D.queuePreload(items, on3DProgress);
  updatePreloadStatus();
}

function flushPendingPreloads() {
  var keys = pendingPreloadSets.slice();
  pendingPreloadSets = [];
  keys.forEach(function (k) { start3DPreload(k); });
}

function on3DProgress(done, total, running, key, setKey) {
  if (key && setKey) mark3DReady(setKey, key);
  updatePreloadStatus();
}

function updatePreloadStatus() {
  var el = $('preloadStatus');
  if (!el) return;
  var st = (typeof window !== 'undefined' && window.BulkFinder3D && window.BulkFinder3D.preloadState)
    ? window.BulkFinder3D.preloadState() : null;
  if (!st || !st.total) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = st.running
    ? '3D models downloading: ' + st.done + '/' + st.total
    : '3D models ready: ' + st.done + '/' + st.total;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('bf3dready', flushPendingPreloads);
}

function buildCard(item) {
  var rem = remOf(item);
  var card = el('article', 'card' + (rem === 0 ? ' done' : ''));
  card.dataset.key = item.setKey + '|' + item.id;

  var photo = el('div', 'photo');
  var img = document.createElement('img');
  img.src = item.img;
  img.alt = ''; // no part names anywhere, photos speak for themselves
  img.loading = 'lazy';
  // A dead image (LEGO has no 192x192 photo for that element — parts
  // 2456, 43093, 6587, 3749, 48183 — or a plain-http link the browser
  // blocks as mixed content, like part 85418's Peeron photo) leaves a
  // blank white box. Try BrickLink's photo of the same part in the
  // same colour first; only if that is dead too, show the part number
  // in its place.
  img.addEventListener('error', function () {
    if (!img.dataset.fbTried) {
      img.dataset.fbTried = '1';
      var fb = fallbackImg(item);
      if (fb && img.src !== fb) { img.src = fb; return; }
    }
    img.style.display = 'none';
    photo.appendChild(el('div', 'photo-fallback', 'Part ' + partNumOf(item)));
  });
  // Tap the photo (not the counter) to open the carousel of reference
  // photos for this part.
  photo.style.cursor = 'pointer';
  photo.addEventListener('click', function () { openViewer(item); });
  photo.appendChild(img);
  card.appendChild(photo);

  card.appendChild(el('div', 'qty', '×' + item.qty));
  card.appendChild(el('div', 'dim', item.dim));
  card.appendChild(el('div', 'colour', displayColour(item)));
  card.appendChild(el('div', 'partnum', 'Part ' + partNumOf(item)));
  // Imported sets carry the Rebrickable part name — handy for a set he
  // hasn't hunted before. The 8961-1 list has no names, so it stays photo-only.
  if (item.name) {
    var nm = el('div', 'partname', item.name);
    nm.title = item.name;
    card.appendChild(nm);
  }

  var counter = el('div', 'counter');
  var minus = el('button', null, '−');
  minus.type = 'button';
  minus.setAttribute('aria-label', 'One fewer still needed');
  minus.disabled = rem === 0;
  minus.addEventListener('click', function () { changeRemaining(item, -1); });
  var plus = el('button', null, '+');
  plus.type = 'button';
  plus.setAttribute('aria-label', 'Undo one found piece');
  plus.disabled = rem === item.qty;
  plus.addEventListener('click', function () { changeRemaining(item, +1); });
  var left = el('span', 'left', leftText(item, rem));
  counter.appendChild(minus);
  counter.appendChild(left);
  counter.appendChild(plus);
  card.appendChild(counter);
  return card;
}

function leftText(item, rem) {
  return rem === 0 ? '✓ 0 of ' + item.qty + ' — done' : rem + ' of ' + item.qty + ' left';
}

// One tap: device first, cloud second. Never wipes local on sync failure.
function changeRemaining(item, delta) {
  var rem = remOf(item);
  var next = Math.max(0, Math.min(item.qty, rem + delta));
  if (next === rem) return;
  // A find plays the stud tick — except the tap that finishes the lot,
  // which plays the minikit jingle instead, so the two never overlap.
  // Completion is per lot in its own set: the same part does not need
  // to be finished in the other sets.
  if (delta < 0) { if (next === 0) playMinikitSound(); else playStudSound(); }
  if (!remainingBySet[item.setKey]) remainingBySet[item.setKey] = {};
  remainingBySet[item.setKey][item.id] = next;
  saveCounts(item.setKey, remainingBySet[item.setKey]);
  updateCardUI(item);
  renderProgress();
  renderSets(); // sidebar "X of 430 found" must move on the same tap
  var meta = findSet(item.setKey);
  if (meta) enqueuePartSync(meta, item);
}

function updateCardUI(item) {
  rebuildCatCounts(); // the tap may have opened or closed a folded section
  var rem = remOf(item);
  var card = document.querySelector('.card[data-key="' + CSS.escape(item.setKey + '|' + item.id) + '"]');
  if (!card) return; // card hidden by the current filter; progress still updated
  card.classList.toggle('done', rem === 0);
  var left = card.querySelector('.left');
  if (left) left.textContent = leftText(item, rem);
  var btns = card.querySelectorAll('.counter button');
  if (btns[0]) btns[0].disabled = rem === 0;
  if (btns[1]) btns[1].disabled = rem === item.qty;
  // If the tap moved the card out of the active filter, hide it.
  if (!cardMatches(item)) card.style.display = 'none';
  rebuildColourSelect();
  rebuildTypeSelect();
}

/* ---------- Sidebar ---------- */
function setImageUrl(setMeta) {
  if (setMeta.set_img_url) return setMeta.set_img_url;
  var inv = getInventory(setMeta.set_num);
  return (inv && inv.set_img_url) || null;
}

// Percent complete for one set, by pieces found.
function setPercent(setMeta) {
  var counts = LS.get(countsKey(setMeta.set_num), null);
  var inv = getInventory(setMeta.set_num);
  if (!inv || !setMeta.total_parts) return '0%';
  var found = 0;
  inv.items.forEach(function (it) {
    var rem = (counts && typeof counts[it.id] === 'number') ? counts[it.id] : it.qty;
    found += (it.qty - rem);
  });
  return Math.round((found / setMeta.total_parts) * 100) + '%';
}

function renderSets() {
  var list = $('setList');
  list.innerHTML = '';
  $('noSetsMsg').hidden = sets.length > 0;
  $('seedBtn').style.display = findSet('8961-1') ? 'none' : '';
  refreshImportButtons();
  sets.forEach(function (s) {
    var li = el('li', selectedKeys.indexOf(s.key) >= 0 ? 'active' : '');
    var text = el('div', 'set-text');
    text.appendChild(el('div', 'set-name', s.set_name));
    text.appendChild(el('div', 'set-num', s.set_num));
    text.appendChild(el('div', 'set-progress', setPercent(s)));
    // Small Instructions button in the middle of the row, between the
    // stats and the thumbnail — opens the set's booklets in the viewer.
    var instrBtn = el('button', 'instr-btn', 'Instructions');
    instrBtn.type = 'button';
    instrBtn.addEventListener('click', function (e) {
      e.stopPropagation(); // don't also open the set
      openInstructions(s.set_num, s.set_name);
    });
    text.appendChild(instrBtn);
    li.appendChild(text);
    var imgUrl = setImageUrl(s);
    if (imgUrl) {
      var img = document.createElement('img');
      img.className = 'set-thumb';
      img.src = imgUrl;
      img.alt = '';
      img.addEventListener('error', function () { img.style.display = 'none'; });
      li.appendChild(img);
    }
    li.addEventListener('click', function () { openSet(s.key); });
    list.appendChild(li);
  });
  renderSetPicker();
}

/* ---------- Set picker: checkboxes + Select all in the filters row ---------- */
function renderSetPicker() {
  var btn = $('setPickerBtn');
  var list = $('setPickerList');
  var allBox = $('setPickerAll');
  if (!btn || !list) return;
  if (!sets.length) btn.textContent = 'Sets';
  else if (selectedKeys.length === sets.length) btn.textContent = 'Sets: All';
  else if (selectedKeys.length === 1) {
    var only = findSet(selectedKeys[0]);
    btn.textContent = 'Sets: ' + (only && only.set_name ? only.set_name : selectedKeys[0]);
  }
  else btn.textContent = 'Sets: ' + selectedKeys.length + ' of ' + sets.length;
  if (allBox) allBox.checked = sets.length > 0 && selectedKeys.length === sets.length;
  list.innerHTML = '';
  sets.forEach(function (s) {
    var label = el('label', 'set-picker-row');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selectedKeys.indexOf(s.key) >= 0;
    box.addEventListener('change', function () { toggleSet(s.key); });
    label.appendChild(box);
    // Titles only — the set number lives in the My sets list below.
    label.appendChild(el('span', null, s.set_name || s.set_num));
    list.appendChild(label);
  });
}

/* ---------- Wire up + init ---------- */
function bindEvents() {
  $('authToggleBtn').addEventListener('click', function () {
    var card = $('authCard');
    card.hidden = !card.hidden;
    if (!card.hidden) setAuthMsg('');
  });
  $('guestBtn').addEventListener('click', function () {
    LS.set('bf:guestDismissed', true);
    $('authCard').hidden = true;
  });
  $('loginBtn').addEventListener('click', doLogin);
  $('signupBtn').addEventListener('click', doSignup);
  $('logoutBtn').addEventListener('click', doLogout);
  $('changePwBtn').addEventListener('click', startChangePassword);
  $('soundToggleBtn').addEventListener('click', function () { setSoundOn(!soundOn); });
  $('menuBtn').addEventListener('click', toggleDrawer);
  $('drawerBackdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  $('forgotBtn').addEventListener('click', doForgotPassword);
  $('pwToggleBtn').addEventListener('click', function () {
    var pw = $('authPassword');
    var show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    $('pwToggleBtn').textContent = show ? 'Hide' : 'Show';
  });
  $('authPassword').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doLogin();
  });
  $('seedBtn').addEventListener('click', addSeedSet);
  $('importBtn').addEventListener('click', importOldProgress);
  $('importSeedBtn').addEventListener('click', importOldProgress);
  $('addSetBtn').addEventListener('click', lookupSet);
  $('setNumInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') lookupSet(); });
  $('addSetConfirmBtn').addEventListener('click', addImportedSet);
  $('addSetCancelBtn').addEventListener('click', function () {
    hideAddSetPreview();
    hideAddSetResults();
    $('addSetMsg').textContent = '';
  });
  document.querySelectorAll('.filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      statusFilter = btn.dataset.filter;
      saveViewState();
      renderSetView();
    });
  });
  $('colourSelect').addEventListener('change', function (e) {
    colourFilter = e.target.value;
    saveViewState();
    renderSetView();
  });

  $('typeSelect').addEventListener('change', function (e) {
    typeFilter = e.target.value;
    saveViewState();
    renderSetView();
  });
  $('setPickerBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    var panel = $('setPickerPanel');
    panel.hidden = !panel.hidden;
  });
  $('setPickerAll').addEventListener('change', function (e) {
    selectAllSets(e.target.checked);
  });
  document.addEventListener('click', function (e) {
    var picker = $('setPicker');
    var panel = $('setPickerPanel');
    if (panel && !panel.hidden && picker && !picker.contains(e.target)) panel.hidden = true;
  });
  // 3D viewer: close with the X or by tapping the dark area outside
  // the model, Escape also closes it.
  $('lightboxClose').addEventListener('click', closeViewer);
  // Tap the dark area around the white model box to close — on phone
  // or computer. The old check (e.target === lightbox) only fired on
  // the thin frame: the preset bar and caption sit INSIDE the
  // .lightbox-3d box, so a tap on that dark area landed on those
  // elements, not the lightbox, and nothing closed. Now anything
  // outside the model box closes, except the buttons (X closes on its
  // own handler; Top/Front/... switch views) and the model box itself
  // (dragging there orbits the part).
  $('lightbox').addEventListener('click', function (e) {
    var model = $('model3d');
    if (model && model.contains && model.contains(e.target)) return;
    if (e.target && e.target.tagName === 'BUTTON') return;
    closeViewer();
  });
  document.addEventListener('keydown', function (e) {
    if (!$('lightbox') || $('lightbox').hidden) return;
    if (e.key === 'Escape') closeViewer();
  });
  // Phone back button: a popstate while the 3D view is open closes
  // the view instead of leaving the site (openViewer pushes the
  // history entry; closeViewer pops it back off).
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('popstate', function () {
      // The browser already popped our pushed entry to fire this event,
      // so clear the flag first — closeViewer must not call history.back()
      // a second time and leave the site.
      if (viewerItem) { viewerHistoryPushed = false; closeViewer(); }
    });
  }
  window.addEventListener('online', function () { updateSyncStatus(); tickSync(); });
  window.addEventListener('offline', updateSyncStatus);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) tickSync();
  });
  // Every 20s: push what's queued, then pull what other devices changed.
  setInterval(tickSync, 20000);
}

async function init() {
  bindEvents();
  setSoundOn(soundOn);
  sets = localSets();
  if (!sb) {
    // Supabase CDN failed (offline on first load): guest mode still works.
    $('syncStatus').textContent = 'Offline — guest mode, saved on this phone';
    $('authToggleBtn').disabled = true;
    $('authToggleBtn').textContent = 'Log in unavailable offline';
  } else {
    try {
      var sess = await sb.auth.getSession();
      if (sess.data && sess.data.session && sess.data.session.user) {
        user = sess.data.session.user;
        subscribeLive();
        await refreshSetsFromCloud();
      }
      sb.auth.onAuthStateChange(handleAuthChange);
    } catch (e) {
      console.warn('auth check failed, continuing as guest', e);
    }
  }
  // A password-reset link lands here with #...&type=recovery in the URL.
  // The recovery session is already in place (getSession above); show
  // the "Set new password" form. Without a session the link is spent
  // or expired — say so and clear it.
  if (sb && isRecoveryUrl()) {
    if (user) {
      enterRecoveryMode();
    } else {
      renderAuth();
      $('authCard').hidden = false;
      setAuthMsg('That reset link didn’t work or has expired — type your email above and tap Forgot password? for a new one.');
      clearUrlHash();
    }
  }
  // Guest path (or a set added on another device): load every set's
  // inventory from the cache table before the first open.
  await loadInventoriesForSets();
  renderAuth();
  renderSets();
  // Restore today's view (filters + set selection); a new day starts
  // fresh at Still needed with every set open.
  var sameDay = loadViewState();
  var last = LS.get('bf:activeSet', null);
  var savedSel = loadSelectedKeys();
  if (sameDay && savedSel && savedSel.length && savedSel.every(function (k) { return findSet(k); })) {
    selectedKeys = savedSel;
    activeSetKey = (last && selectedKeys.indexOf(last) >= 0) ? last : selectedKeys[0];
    loadSelected();
  } else if (!sameDay && sets.length) {
    activeSetKey = sets[0].key;
    LS.set('bf:activeSet', activeSetKey);
    selectAllSets(true);
  } else if (last && findSet(last)) openSet(last);
  else if (sets.length) openSet(sets[0].key);
  else showEmpty();
  viewRestored = true;
  updateSyncStatus();
}

document.addEventListener('DOMContentLoaded', init);

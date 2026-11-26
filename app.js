/* Bulk Finder v3.36 — multi-set LEGO bulk-hunt tracker.
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
var INVENTORY_8961 = {"set": "8961-1 Crystal Sweeper", "set_img_url": "https://cdn.rebrickable.com/media/sets/8961-1.jpg", "lots": 138, "pieces": 430, "tiers": {"1": "MOST LIKELY IN BULK", "2": "MEDIUM \u2014 WORTH A DIG", "3": "LEAST LIKELY IN BULK"}, "items": [{"id": "300126-3001-Black", "qty": 16, "dim": "2 \u00d7 4 studs", "colour": "Black", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/300126.jpg"}, {"id": "4121715-2780-Black", "qty": 8, "dim": "2 studs long", "colour": "", "any": true, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4121715.jpg"}, {"id": "614126-6141-Black", "qty": 4, "dim": "1 \u00d7 1 studs", "colour": "", "any": true, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/614126.jpg"}, {"id": "4535739-63868-Black", "qty": 4, "dim": "2 \u00d7 1 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4535739.jpg"}, {"id": "4556158-60470-Black", "qty": 4, "dim": "1 \u00d7 2 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4556158.jpg"}, {"id": "302026-3020-Black", "qty": 2, "dim": "2 \u00d7 4 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/302026.jpg"}, {"id": "403226-4032-Black", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/403226.jpg"}, {"id": "4569733-88072-Black", "qty": 2, "dim": "1 \u00d7 2 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4569733.jpg"}, {"id": "370826-3708-Black", "qty": 2, "dim": "12 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/370826.jpg"}, {"id": "4526982-62462-Black", "qty": 2, "dim": "2 studs long", "colour": "", "any": true, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4526982.jpg"}, {"id": "416226-4162-Black", "qty": 2, "dim": "1 \u00d7 8 studs", "colour": "Black", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/416226.jpg"}, {"id": "4158848-30552-Black", "qty": 1, "dim": "1 stud", "colour": "", "any": true, "tier": 1, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4158848.jpg"}, {"id": "370726-3707-Black", "qty": 1, "dim": "8 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/370726.jpg"}, {"id": "4211086-6587-Dark_Stone_Grey", "qty": 13, "dim": "3 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211086.jpg"}, {"id": "4508553-59426-Dark_Stone_Grey", "qty": 4, "dim": "5\u00bd studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4508553.jpg"}, {"id": "4210798-6112-Dark_Stone_Grey", "qty": 2, "dim": "1 \u00d7 12 studs", "colour": "", "any": true, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4210798.jpg"}, {"id": "4211061-3035-Dark_Stone_Grey", "qty": 2, "dim": "4 \u00d7 8 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211061.jpg"}, {"id": "4256149-3028-Dark_Stone_Grey", "qty": 2, "dim": "6 \u00d7 12 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4256149.jpg"}, {"id": "4211055-3068-Dark_Stone_Grey", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211055.jpg"}, {"id": "4211396-3021-Medium_Stone_Grey", "qty": 12, "dim": "2 \u00d7 3 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211396.jpg"}, {"id": "4211622-6590-Medium_Stone_Grey", "qty": 9, "dim": "1 stud", "colour": "", "any": true, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211622.jpg"}, {"id": "4521921-54200-Medium_Stone_Grey", "qty": 8, "dim": "1 \u00d7 1 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4521921.jpg"}, {"id": "4211503-4599-Medium_Stone_Grey", "qty": 6, "dim": "1 \u00d7 1 stud", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Miscellaneous", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211503.jpg"}, {"id": "4211639-32073-Medium_Stone_Grey", "qty": 6, "dim": "5 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211639.jpg"}, {"id": "4515369-60478-Medium_Stone_Grey", "qty": 4, "dim": "1 \u00d7 2 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4515369.jpg"}, {"id": "4211406-3034-Medium_Stone_Grey", "qty": 3, "dim": "2 \u00d7 8 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211406.jpg"}, {"id": "4211397-3022-Medium_Stone_Grey", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211397.jpg"}, {"id": "4211360-2445-Medium_Stone_Grey", "qty": 1, "dim": "2 \u00d7 12 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211360.jpg"}, {"id": "4211526-6143-Medium_Stone_Grey", "qty": 1, "dim": "\u00d816 mm", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211526.jpg"}, {"id": "4211696-30388-Medium_Stone_Grey", "qty": 1, "dim": "1 \u00d7 6 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211696.jpg"}, {"id": "4215971-40902-Medium_Stone_Grey", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4215971.jpg"}, {"id": "4211483-4274-Medium_Stone_Grey", "qty": 1, "dim": "1 stud", "colour": "", "any": true, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211483.jpg"}, {"id": "4211805-44294-Medium_Stone_Grey", "qty": 1, "dim": "7 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211805.jpg"}, {"id": "302201-3022-White", "qty": 3, "dim": "2 \u00d7 2 studs", "colour": "White", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/302201.jpg"}, {"id": "4140583-2540-White", "qty": 3, "dim": "1 \u00d7 2 studs", "colour": "White", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4140583.jpg"}, {"id": "408501-4085-White", "qty": 2, "dim": "1 \u00d7 1 studs", "colour": "White", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/408501.jpg"}, {"id": "4533763-60475-White", "qty": 2, "dim": "1 \u00d7 1 studs", "colour": "White", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4533763.jpg"}, {"id": "379401-3794-White", "qty": 1, "dim": "1 \u00d7 2 studs", "colour": "White", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/379401.jpg"}, {"id": "379501-3795-White", "qty": 1, "dim": "2 \u00d7 6 studs", "colour": "White", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/379501.jpg"}, {"id": "3005740-30057-Transparent", "qty": 6, "dim": "1 \u00d7 1 studs", "colour": "Clear", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/3005740.jpg"}, {"id": "4206482-43093-Bright_Blue", "qty": 6, "dim": "1 stud", "colour": "Blue", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4206482.jpg"}, {"id": "4239601-32123-Bright_Yellow", "qty": 6, "dim": "\u00bd stud", "colour": "", "any": true, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4239601.jpg"}, {"id": "4164022-3004-Bright_Yellowish_Green", "qty": 13, "dim": "1 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4164022.jpg"}, {"id": "4164037-3023-Bright_Yellowish_Green", "qty": 13, "dim": "1 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4164037.jpg"}, {"id": "4220631-3002-Bright_Yellowish_Green", "qty": 10, "dim": "2 \u00d7 3 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4220631.jpg"}, {"id": "4187743-3710-Bright_Yellowish_Green", "qty": 7, "dim": "1 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4187743.jpg"}, {"id": "4212446-6091-Bright_Yellowish_Green", "qty": 6, "dim": "1 \u00d7 1 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4212446.jpg"}, {"id": "4537927-61678-Bright_Yellowish_Green", "qty": 6, "dim": "1 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4537927.jpg"}, {"id": "4164021-2431-Bright_Yellowish_Green", "qty": 4, "dim": "1 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4164021.jpg"}, {"id": "4220632-3003-Bright_Yellowish_Green", "qty": 4, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4220632.jpg"}, {"id": "4160593-2431-Bright_Orange", "qty": 3, "dim": "1 \u00d7 4 studs", "colour": "Orange", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4160593.jpg"}, {"id": "4158355-3020-Bright_Orange", "qty": 2, "dim": "2 \u00d7 4 studs", "colour": "Orange", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4158355.jpg"}, {"id": "4234716-3010-Bright_Yellowish_Green", "qty": 2, "dim": "1 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4234716.jpg"}, {"id": "4500755-52031-Bright_Yellowish_Green", "qty": 2, "dim": "4 \u00d7 6 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4500755.jpg"}, {"id": "4504705-30565-Bright_Yellowish_Green", "qty": 2, "dim": "4 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4504705.jpg"}, {"id": "4529160-3666-Bright_Yellowish_Green", "qty": 2, "dim": "1 \u00d7 6 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4529160.jpg"}, {"id": "4541490-44126-Bright_Yellowish_Green", "qty": 2, "dim": "2 \u00d7 6 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541490.jpg"}, {"id": "3000841-30008-Transparent_Red", "qty": 2, "dim": "1 \u00d7 1 studs", "colour": "Trans-Red", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/3000841.jpg"}, {"id": "4538144-62462-Bright_Orange", "qty": 1, "dim": "2 studs long", "colour": "", "any": true, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538144.jpg"}, {"id": "4504850-3031-Bright_Yellowish_Green", "qty": 1, "dim": "4 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4504850.jpg"}, {"id": "4541957-4150-Bright_Yellowish_Green", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541957.jpg"}, {"id": "4299389-56145-Black", "qty": 6, "dim": "\u00d830 mm", "colour": "Black", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4299389.jpg"}, {"id": "370126-3701-Black", "qty": 2, "dim": "1 \u00d7 4 studs", "colour": "", "any": true, "tier": 2, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/370126.jpg"}, {"id": "4100423-6087-Black", "qty": 2, "dim": "2 \u00d7 5 studs", "colour": "", "any": true, "tier": 2, "cat": "Miscellaneous", "img": "https://img.bricklink.com/ItemImage/PN/11/6087.png"}, {"id": "4216660-30367-Black", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4216660.jpg"}, {"id": "4244953-50861-Black", "qty": 2, "dim": "\u00d821 mm", "colour": "Black", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4244953.jpg"}, {"id": "4502834-53992-Black", "qty": 2, "dim": "\u22482 studs long", "colour": "Black", "any": false, "tier": 2, "cat": "Technic Special", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4502834.jpg"}, {"id": "4538456-64644-Black", "qty": 2, "dim": "\u22483 studs long", "colour": "Black", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538456.jpg"}, {"id": "4112282-6629-Black", "qty": 2, "dim": "4 \u00d7 6 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Technic Beams", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4112282.jpg"}, {"id": "602026-6020-Black", "qty": 1, "dim": "1 \u00d7 4 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Bars, Ladders and Fences", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/602026.jpg"}, {"id": "4153044-30663-Black", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Miscellaneous", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4153044.jpg"}, {"id": "4527063-62698-Black", "qty": 1, "dim": "1 \u00d7 2 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4527063.jpg"}, {"id": "4211064-3747-Dark_Stone_Grey", "qty": 8, "dim": "2 \u00d7 3 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211064.jpg"}, {"id": "4210631-2412-Dark_Stone_Grey", "qty": 6, "dim": "1 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4210631.jpg"}, {"id": "4540386-61409-Dark_Stone_Grey", "qty": 4, "dim": "1 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540386.jpg"}, {"id": "4514558-3648-Dark_Stone_Grey", "qty": 3, "dim": "\u00d824 mm", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4514558.jpg"}, {"id": "4161674-30367-Dark_Stone_Grey", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4161674.jpg"}, {"id": "4210645-30170-Dark_Stone_Grey", "qty": 2, "dim": "minifig", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4210645.jpg"}, {"id": "4219725-3633-Dark_Stone_Grey", "qty": 2, "dim": "1 \u00d7 4 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Bars, Ladders and Fences", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4219725.jpg"}, {"id": "4520307-61780-Dark_Stone_Grey", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Miscellaneous", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4520307.jpg"}, {"id": "4211054-3039-Dark_Stone_Grey", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211054.jpg"}, {"id": "4516456-60169-Dark_Stone_Grey", "qty": 1, "dim": "16 studs long", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "String, Bands and Reels", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4516456.jpg"}, {"id": "4522784-47455-Dark_Stone_Grey", "qty": 1, "dim": "\u22482 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4522784.jpg"}, {"id": "4277927-44728-Medium_Stone_Grey", "qty": 4, "dim": "1 \u00d7 2 studs", "colour": "Light Grey", "any": false, "tier": 2, "cat": "Plates Special", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4277927.jpg"}, {"id": "4211847-30360-Medium_Stone_Grey", "qty": 2, "dim": "3 \u00d7 3 studs", "colour": "Light Grey", "any": false, "tier": 2, "cat": "Technic Steering, Suspension and Engine", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211847.jpg"}, {"id": "4590443-50862-Medium_Stone_Grey", "qty": 2, "dim": "\u00d815 mm", "colour": "Light Grey", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4590443.jpg"}, {"id": "4211819-4515-Medium_Stone_Grey", "qty": 1, "dim": "6 \u00d7 8 studs", "colour": "", "any": true, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211819.jpg"}, {"id": "4523403-60779-White", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "White", "any": false, "tier": 2, "cat": "Flags, Banners and Signs", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4523403.jpg"}, {"id": "4521210-60592-White", "qty": 1, "dim": "1 \u00d7 2 studs", "colour": "White", "any": false, "tier": 2, "cat": "Windows and Doors", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4521210.jpg"}, {"id": "4278412-54196-Transparent", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Clear", "any": false, "tier": 2, "cat": "Plates Round Curved and Dishes", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4278412.jpg"}, {"id": "281721-2817-Bright_Red", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Red", "any": false, "tier": 2, "cat": "Technic Special", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/281721.jpg"}, {"id": "4538780-64728-Bright_Red", "qty": 2, "dim": "\u22481 stud", "colour": "Red", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538780.jpg"}, {"id": "4540418-30325-Bright_Blue", "qty": 2, "dim": "minifig", "colour": "Blue", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540418.jpg"}, {"id": "4114584-33085-Bright_Yellow", "qty": 1, "dim": "\u22481 stud", "colour": "Yellow", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4114584.jpg"}, {"id": "4540385-61409-Bright_Yellowish_Green", "qty": 8, "dim": "1 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540385.jpg"}, {"id": "4494219-4185-Bright_Yellowish_Green", "qty": 8, "dim": "\u00d824 mm", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4494219.jpg"}, {"id": "4540817-32348-Bright_Orange", "qty": 6, "dim": "4 \u00d7 4 studs", "colour": "Orange", "any": false, "tier": 2, "cat": "Technic Beams", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540817.jpg"}, {"id": "4529679-3660-Bright_Yellowish_Green", "qty": 4, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4529679.jpg"}, {"id": "4244369-50746-Transparent_Bright_Orange", "qty": 4, "dim": "1 \u00d7 1 studs", "colour": "Trans-Orange", "any": false, "tier": 2, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4244369.jpg"}, {"id": "4540299-64711-Bright_Orange", "qty": 2, "dim": "\u00d862 mm", "colour": "Orange", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540299.jpg"}, {"id": "4529045-33243-Bright_Yellowish_Green", "qty": 2, "dim": "1 \u00d7 3 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Bricks Curved", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4529045.jpg"}, {"id": "4261453-6536-Bright_Yellowish_Green", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4261453.jpg"}, {"id": "4265684-32523-Bright_Yellowish_Green", "qty": 2, "dim": "3 studs long", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Technic Beams", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4265684.jpg"}, {"id": "4508713-32009-Bright_Yellowish_Green", "qty": 2, "dim": "3 \u00d7 7 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Technic Beams", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4508713.jpg"}, {"id": "4119483-30153-Transparent_Blue", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Blue", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4119483.jpg"}, {"id": "4541538-30385-Transparent_Blue", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Blue", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541538.jpg"}, {"id": "4541536-30385-Transparent_Bright_Orange", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Orange", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541536.jpg"}, {"id": "4114505-30153-Transparent_Fluorescent_Green", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Green", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4114505.jpg"}, {"id": "4541537-30385-Transparent_Red", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Red", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541537.jpg"}, {"id": "4518029-59900-Bright_Orange", "qty": 1, "dim": "1 \u00d7 1 studs", "colour": "Orange", "any": false, "tier": 2, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4518029.jpg"}, {"id": "4537923-30499-Bright_Yellowish_Green", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4537923.jpg"}, {"id": "4552036-86209-Transparent_Brown", "qty": 1, "dim": "1 \u00d7 2 studs", "colour": "Trans-Brown", "any": false, "tier": 2, "cat": "Windows and Doors", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4552036.jpg"}, {"id": "4544720-64288-Transparent_Red", "qty": 1, "dim": "1 \u00d7 1 studs", "colour": "Trans-Red", "any": false, "tier": 2, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4544720.jpg"}, {"id": "4107558-32018-Black", "qty": 4, "dim": "1 \u00d7 14 studs", "colour": "Black", "any": false, "tier": 3, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4107558.jpg"}, {"id": "4530673-50859-Black", "qty": 1, "dim": "6 studs long", "colour": "Black", "any": false, "tier": 3, "cat": "Transportation - Land", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4530673.jpg"}, {"id": "4539385-64450-Black", "qty": 1, "dim": "4 \u00d7 6 studs", "colour": "Black", "any": false, "tier": 3, "cat": "Miscellaneous", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4539385.jpg"}, {"id": "4211006-3837-Dark_Stone_Grey", "qty": 1, "dim": "\u22483 studs long", "colour": "Dark Grey", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211006.jpg"}, {"id": "4542545-76382-Medium_Stone_Grey", "qty": 1, "dim": "minifig torso", "colour": "Light Grey", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542545.jpg"}, {"id": "4538783-64713-Medium_Stone_Grey", "qty": 1, "dim": "4 \u00d7 4 studs", "colour": "Light Grey", "any": false, "tier": 3, "cat": "Bricks Round and Cones", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538783.jpg"}, {"id": "73737-73587-White", "qty": 4, "dim": "\u22482 studs long", "colour": "White", "any": false, "tier": 3, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/73737.jpg"}, {"id": "4542547-76382-White", "qty": 1, "dim": "minifig torso", "colour": "White", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542547.jpg"}, {"id": "85418-85418-White", "qty": 1, "dim": "sticker sheet", "colour": "White", "any": false, "tier": 3, "cat": "Stickers", "img": "http://media.peeron.com/pics/inv/custpics/thumbs/85418.1246725805.jpg"}, {"id": "4542552-85107-Bright_Blue", "qty": 2, "dim": "minifig legs", "colour": "Blue", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542552.jpg"}, {"id": "4542171-64881-Bright_Yellow", "qty": 1, "dim": "minifig head", "colour": "Yellow", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542171.jpg"}, {"id": "4542175-64882-Bright_Yellow", "qty": 1, "dim": "minifig head", "colour": "Yellow", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542175.jpg"}, {"id": "4281515-41669-Bright_Orange", "qty": 24, "dim": "3 studs long", "colour": "Orange", "any": false, "tier": 3, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4281515.jpg"}, {"id": "4508647-2634-{Not_Specified}", "qty": 1, "dim": "2 \u00d7 8 studs", "colour": "White", "any": false, "tier": 3, "cat": "Windows and Doors", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4508647.jpg"}, {"id": "4521107-50860-Bright_Orange", "qty": 1, "dim": "\u22486 studs long", "colour": "Orange", "any": false, "tier": 3, "cat": "Transportation - Land", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4521107.jpg"}, {"id": "4538363-30300-Bright_Orange", "qty": 1, "dim": "8 \u00d7 12 studs", "colour": "Orange", "any": false, "tier": 3, "cat": "Plates Special", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538363.jpg"}, {"id": "4541465-64786-Transparent_Blue", "qty": 1, "dim": "\u22482 \u00d7 2 studs", "colour": "Trans-Blue", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541465.jpg"}, {"id": "4538017-64786-Transparent_Red", "qty": 1, "dim": "\u22482 \u00d7 2 studs", "colour": "Trans-Red", "any": false, "tier": 3, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538017.jpg"}, {"id": "4186017-6562-Brick_Yellow", "qty": 1, "dim": "3 studs long", "colour": "", "any": true, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4186017.jpg"}, {"id": "4210677-30088-Dark_Stone_Grey", "qty": 1, "dim": "5 studs long", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Minifig / Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4210677.jpg"}, {"id": "4225973-48169-Dark_Stone_Grey", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 3, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4225973.jpg"}, {"id": "4225975-48171-Dark_Stone_Grey", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 3, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4225975.jpg"}, {"id": "4261715-3297-Dark_Stone_Grey", "qty": 2, "dim": "3 \u00d7 4 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4261715.jpg"}, {"id": "4528323-60474-Dark_Stone_Grey", "qty": 1, "dim": "4 \u00d7 4 studs", "colour": "Dark Grey", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4528323.jpg"}, {"id": "4517986-61485-Black", "qty": 1, "dim": "4 \u00d7 4 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Hinges, Arms and Turntables", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4517986.jpg"}]};
// One-time import snapshot: Joseph's progress in the old Muse-hosted
// 8961-1 tracker, as of 2026-11-15 09:26 MST — 340 of 430 found, 96 of 138
// lots done. Key = lot id, value = pieces still to find. Used only by
// importOldProgress(); never fetched from the network.
const IMPORT_8961_PROGRESS = {"300126-3001-Black":0,"4121715-2780-Black":0,"614126-6141-Black":0,"4535739-63868-Black":0,"4556158-60470-Black":0,"302026-3020-Black":0,"403226-4032-Black":0,"4569733-88072-Black":0,"370826-3708-Black":0,"4526982-62462-Black":0,"416226-4162-Black":0,"4158848-30552-Black":0,"370726-3707-Black":0,"4211086-6587-Dark_Stone_Grey":0,"4508553-59426-Dark_Stone_Grey":0,"4210798-6112-Dark_Stone_Grey":0,"4211061-3035-Dark_Stone_Grey":0,"4256149-3028-Dark_Stone_Grey":0,"4211055-3068-Dark_Stone_Grey":0,"4211396-3021-Medium_Stone_Grey":0,"4211622-6590-Medium_Stone_Grey":0,"4521921-54200-Medium_Stone_Grey":0,"4211503-4599-Medium_Stone_Grey":0,"4211639-32073-Medium_Stone_Grey":0,"4515369-60478-Medium_Stone_Grey":0,"4211406-3034-Medium_Stone_Grey":0,"4211397-3022-Medium_Stone_Grey":0,"4211360-2445-Medium_Stone_Grey":0,"4211526-6143-Medium_Stone_Grey":0,"4211696-30388-Medium_Stone_Grey":1,"4215971-40902-Medium_Stone_Grey":1,"4211483-4274-Medium_Stone_Grey":0,"4211805-44294-Medium_Stone_Grey":0,"302201-3022-White":0,"4140583-2540-White":0,"408501-4085-White":0,"4533763-60475-White":0,"379401-3794-White":0,"379501-3795-White":0,"3005740-30057-Transparent":0,"4206482-43093-Bright_Blue":0,"4239601-32123-Bright_Yellow":0,"4164022-3004-Bright_Yellowish_Green":0,"4164037-3023-Bright_Yellowish_Green":0,"4220631-3002-Bright_Yellowish_Green":0,"4187743-3710-Bright_Yellowish_Green":0,"4212446-6091-Bright_Yellowish_Green":0,"4537927-61678-Bright_Yellowish_Green":0,"4164021-2431-Bright_Yellowish_Green":0,"4220632-3003-Bright_Yellowish_Green":0,"4160593-2431-Bright_Orange":2,"4158355-3020-Bright_Orange":0,"4234716-3010-Bright_Yellowish_Green":0,"4500755-52031-Bright_Yellowish_Green":1,"4504705-30565-Bright_Yellowish_Green":0,"4529160-3666-Bright_Yellowish_Green":0,"4541490-44126-Bright_Yellowish_Green":2,"3000841-30008-Transparent_Red":0,"4538144-62462-Bright_Orange":1,"4504850-3031-Bright_Yellowish_Green":0,"4541957-4150-Bright_Yellowish_Green":0,"4299389-56145-Black":0,"370126-3701-Black":0,"4100423-6087-Black":2,"4216660-30367-Black":2,"4244953-50861-Black":0,"4502834-53992-Black":0,"4538456-64644-Black":0,"4112282-6629-Black":0,"602026-6020-Black":0,"4153044-30663-Black":1,"4527063-62698-Black":1,"4211064-3747-Dark_Stone_Grey":0,"4210631-2412-Dark_Stone_Grey":0,"4540386-61409-Dark_Stone_Grey":0,"4514558-3648-Dark_Stone_Grey":0,"4161674-30367-Dark_Stone_Grey":2,"4210645-30170-Dark_Stone_Grey":2,"4219725-3633-Dark_Stone_Grey":2,"4520307-61780-Dark_Stone_Grey":2,"4211054-3039-Dark_Stone_Grey":0,"4516456-60169-Dark_Stone_Grey":1,"4522784-47455-Dark_Stone_Grey":0,"4277927-44728-Medium_Stone_Grey":0,"4211847-30360-Medium_Stone_Grey":0,"4590443-50862-Medium_Stone_Grey":2,"4211819-4515-Medium_Stone_Grey":1,"4523403-60779-White":2,"4521210-60592-White":1,"4278412-54196-Transparent":2,"281721-2817-Bright_Red":2,"4538780-64728-Bright_Red":1,"4540418-30325-Bright_Blue":1,"4114584-33085-Bright_Yellow":1,"4540385-61409-Bright_Yellowish_Green":0,"4494219-4185-Bright_Yellowish_Green":0,"4540817-32348-Bright_Orange":6,"4529679-3660-Bright_Yellowish_Green":0,"4244369-50746-Transparent_Bright_Orange":0,"4540299-64711-Bright_Orange":0,"4529045-33243-Bright_Yellowish_Green":0,"4261453-6536-Bright_Yellowish_Green":0,"4265684-32523-Bright_Yellowish_Green":0,"4508713-32009-Bright_Yellowish_Green":0,"4119483-30153-Transparent_Blue":2,"4541538-30385-Transparent_Blue":2,"4541536-30385-Transparent_Bright_Orange":2,"4114505-30153-Transparent_Fluorescent_Green":2,"4541537-30385-Transparent_Red":2,"4518029-59900-Bright_Orange":0,"4537923-30499-Bright_Yellowish_Green":1,"4552036-86209-Transparent_Brown":1,"4544720-64288-Transparent_Red":0,"4107558-32018-Black":0,"4530673-50859-Black":0,"4539385-64450-Black":1,"4211006-3837-Dark_Stone_Grey":0,"4542545-76382-Medium_Stone_Grey":0,"4538783-64713-Medium_Stone_Grey":1,"73737-73587-White":4,"4542547-76382-White":0,"85418-85418-White":1,"4542552-85107-Bright_Blue":0,"4542171-64881-Bright_Yellow":0,"4542175-64882-Bright_Yellow":0,"4281515-41669-Bright_Orange":24,"4508647-2634-{Not_Specified}":1,"4521107-50860-Bright_Orange":0,"4538363-30300-Bright_Orange":1,"4541465-64786-Transparent_Blue":1,"4538017-64786-Transparent_Red":1,"4186017-6562-Brick_Yellow":0,"4210677-30088-Dark_Stone_Grey":1,"4225973-48169-Dark_Stone_Grey":0,"4225975-48171-Dark_Stone_Grey":0,"4261715-3297-Dark_Stone_Grey":0,"4528323-60474-Dark_Stone_Grey":0,"4517986-61485-Black":0};

/* ---------- Supabase client (guarded: guest mode works offline) ---------- */
var sb = null;
if (window.supabase && window.supabase.createClient) {
  // Stay signed in: the session is saved in this device's own
  // localStorage and the client refreshes its own token, so closing
  // the app — or coming back tomorrow — must not ask for the password
  // again. These are the supabase-js defaults, spelled out so a CDN
  // update can never flip them silently; the key is the stock
  // sb-<project-ref>-auth-token one, so a login saved before this
  // version keeps working.
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: 'sb-xwekulsnfarjibawqqih-auth-token',
    },
  });
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
 * 'Miscellaneous' (the old 'Random' bucket is gone).
 * Small pieces is the one non-Rebrickable bucket: 1x1 / single-stud
 * bricks and plates, plus small Technic connectors — pins, bushes and
 * pin connectors are 1–3 studs of tiny connector, and the Technic tooth
 * (41669) and mini antenna (73587) are the same kind of small piece
 * (Joseph, 2026-11-20; the rule lives in itemCat below and in the
 * import transform, so it holds for old sets and new ones alike).
 * Future sets from the Rebrickable lookup carry
 * their own part_cat_id, so this dropdown works for any set with no
 * hand-mapping.
 *
 * Display rule (Joseph's audit, 2026-11-15; threshold loosened to 2 on
 * 2026-11-20): a raw category keeps its own section only while 2 or
 * more of its lots still have pieces left to find — fewer than 2 open
 * lots folds into 'Miscellaneous' at display time, so single-lot
 * sections never get their own dropdown entry. Tubes and Hoses
 * (2 lots) is the smallest section that stands on its own.
 * 'Minifig / Accessories' is exempt — he placed the minifig gear there
 * on purpose. Empty categories never appear: the dropdown is built
 * from the lots that are actually there. */
// Small Technic connectors are Small pieces (Joseph, 2026-11-20) —
// the same rule as the import transform, applied here so sets already
// in the app move without re-importing. Pins, bushes and pin connectors
// are 1–3 studs of tiny connector; the mini antenna (73587) and the
// Technic tooth (41669) are the same kind of small piece. Part numbers,
// so it holds for the 8961-1 list (no names) and for cached inventories
// whose stored cat is stale — a pin's old 'Technic Pins / Bushes', a
// connector's 'Tubes and Hoses', 73587's one-off Miscellaneous.
var SMALL_CONNECTOR_PARTS = { '6590': 1, '73587': 1, '41669': 1, '62462': 1 };
function itemCat(item) {
  if (SMALL_CONNECTOR_PARTS[partNumOf(item)]) return 'Small pieces';
  if (item.cat === 'Technic Pins / Bushes' || item.cat === 'Technic Connectors') return 'Small pieces';
  return item.cat || 'Other';
}

// Lots still open (pieces remaining) per raw category, per set — rebuilt
// when the selection loads and whenever a count changes, so the fold
// follows what is actually left to find, not the full inventory.
// In a multi-set view the fold also counts distinct merged pieces per
// category (catLotCountMerged), so a merged card folds the same way the
// cards around it do.
var catLotCount = {};
var catLotCountMerged = {};
function rebuildCatCounts() {
  catLotCount = {};
  items.forEach(function (it) {
    if (remOf(it) <= 0) return; // a fully found lot no longer holds a section open
    var m = catLotCount[it.setKey] || (catLotCount[it.setKey] = {});
    var c = itemCat(it);
    m[c] = (m[c] || 0) + 1;
  });
  catLotCountMerged = {};
  if (selectedKeys.length > 1) {
    viewList().forEach(function (it) {
      if (remOf(it) <= 0) return;
      var c = itemCat(it);
      catLotCountMerged[c] = (catLotCountMerged[c] || 0) + 1;
    });
  }
}

// The category shown in the type dropdown and used by the type filter.
function displayCat(item) {
  var raw = itemCat(item);
  if (raw === 'Miscellaneous' || raw === 'Minifig / Accessories') return raw;
  if (item.merged) {
    if ((catLotCountMerged[raw] || 0) <= 1) return 'Miscellaneous';
    return raw;
  }
  var m = catLotCount[item.setKey];
  if (m && (m[raw] || 0) <= 1) return 'Miscellaneous';
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
 * bf:guestDismissed  — auth card dismissed for this session's guest
 * bf:bulkLists       — scanned bulk lists (local only): [{ id, name,
 *                      created, parts: [{ part, name, colour, qty, img }] }] */
var LS = {
  get: function (k, fallback) {
    try {
      var v = localStorage.getItem(k);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set: function (k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full/blocked: taps still work in memory */ }
  },
  remove: function (k) {
    try { localStorage.removeItem(k); } catch (e) { /* already gone */ }
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

/* ---------- Columns across ("Displayed", v3.24) ----------
 * Two saved values, one per device type, each remembered on this device
 * (same localStorage pattern as the sound toggle — bf:cols:phone /
 * bf:cols:desktop, NOT synced to the account, so the phone's number
 * stays on the phone and the laptop's stays on the laptop):
 * phone (viewport <= 700px): 2-4 across, default 2; computer: 2-5
 * across, default 5 (the view it already had). The grid reads the CSS
 * variable --bf-cols, so a re-render picks a change up with no extra
 * work. The sidebar control always edits the setting for the device in
 * hand — resizing across the phone/laptop boundary switches which
 * value it shows and which value it saves. */
var COLS_PHONE = { key: 'bf:cols:phone', min: 2, max: 4, def: 2 };
var COLS_DESKTOP = { key: 'bf:cols:desktop', min: 2, max: 5, def: 5 };
function colsBand() {
  return (typeof window !== 'undefined' && window.innerWidth <= 700) ? COLS_PHONE : COLS_DESKTOP;
}
function colsClamp(n, band) {
  n = parseInt(n, 10);
  if (isNaN(n)) return band.def;
  return Math.max(band.min, Math.min(band.max, n));
}
function getCols(band) {
  return colsClamp(LS.get(band.key, band.def), band);
}
function setCols(n, band) {
  band = band || colsBand();
  var v = colsClamp(n, band);
  LS.set(band.key, v);
  applyCols();
  return v;
}
// Push the current band's saved value into the grid + the control.
function applyCols() {
  var band = colsBand();
  var n = getCols(band);
  if (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && document.documentElement.style.setProperty) {
    document.documentElement.style.setProperty('--bf-cols', String(n));
  }
  var input = $('colsInput');
  if (input) {
    input.value = String(n);
    input.min = String(band.min);
    input.max = String(band.max);
  }
  var minus = $('colsMinusBtn');
  if (minus) minus.disabled = n <= band.min;
  var plus = $('colsPlusBtn');
  if (plus) plus.disabled = n >= band.max;
  return n;
}

/* ---------- State ---------- */
var user = null;              // Supabase auth user, or null = guest
var sets = [];                // [{ key, set_num, set_name, total_parts, total_lots, user_set_id }]
var activeSetKey = null;      // set_num of the set the sidebar last opened
var selectedKeys = [];        // set keys shown together in the combined view
var items = [];               // combined inventory of the selected sets (each item carries setKey)
var remainingBySet = {};      // setKey -> { partKey -> pieces still to find }
// Pieces still to find for one combined-view item (its own set's map).
// A merged card (v3.32) sums what is left across its sets.
function remOf(item) {
  if (item.merged) {
    var total = 0;
    item.lots.forEach(function (lot) {
      var m = remainingBySet[lot.setKey];
      total += (m && m[lot.id] !== undefined) ? m[lot.id] : lot.qty;
    });
    return total;
  }
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
      if (!inv) return; // inventory not loaded (its fetch failed): the
      // merge waits for the next open instead of crashing the refresh.
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
  // A deleted set's cloud row may still be out there (offline delete):
  // never let the pull resurrect it — the tombstone's retry wipes it.
  var tombs = deletedSets();
  cloud = cloud.filter(function (s) { return !tombs[s.user_set_id]; });
  var local = localSets();
  // v3.30 — the sidebar order is the user's order: start from the
  // local list (so a grip reorder survives a cloud refresh) and
  // append cloud-only sets at the end. Cloud data still wins per set
  // (it carries the account id); only the position comes from local.
  var byNum = {};
  var order = [];
  local.forEach(function (s) { byNum[s.set_num] = s; order.push(s.set_num); });
  cloud.forEach(function (s) {
    if (!byNum[s.set_num]) { byNum[s.set_num] = s; order.push(s.set_num); }
    else byNum[s.set_num] = s;
  });
  sets = order.map(function (k) {
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
  await retryDeletedSets();
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

/* ---------- Confirm modal ----------
 * One shared Yes/Cancel popup for destructive or wide actions (delete
 * a set, mark a set complete). Real buttons, not window.confirm, so it
 * looks like the app and works in the PWA. Built once in JS; the
 * title/message/confirm elements are kept by reference (getElementById
 * would miss them in a stub DOM, and the modal is built, not in HTML).
 * z-index sits above the instructions viewer, so it can confirm a
 * build action from inside the viewer too. */
var confirmModal = null;
var confirmTitleEl = null;
var confirmMsgEl = null;
var confirmYesEl = null;
var confirmCallback = null;
function ensureConfirmModal() {
  if (confirmModal) return confirmModal;
  var overlay = document.createElement('div');
  overlay.className = 'confirm-modal';
  overlay.hidden = true;
  var box = document.createElement('div');
  box.className = 'confirm-box';
  confirmTitleEl = document.createElement('h3');
  box.appendChild(confirmTitleEl);
  confirmMsgEl = document.createElement('p');
  box.appendChild(confirmMsgEl);
  var row = document.createElement('div');
  row.className = 'confirm-buttons';
  var no = document.createElement('button');
  no.type = 'button'; no.className = 'btn'; no.textContent = 'Cancel';
  no.addEventListener('click', hideConfirm);
  confirmYesEl = document.createElement('button');
  confirmYesEl.type = 'button'; confirmYesEl.className = 'btn btn-danger';
  confirmYesEl.addEventListener('click', function () {
    var cb = confirmCallback; confirmCallback = null; hideConfirm();
    if (cb) cb();
  });
  row.appendChild(no); row.appendChild(confirmYesEl);
  box.appendChild(row);
  overlay.appendChild(box);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) hideConfirm(); });
  document.body.appendChild(overlay);
  confirmModal = overlay;
  return overlay;
}
function showConfirm(opts) {
  var m = ensureConfirmModal();
  confirmTitleEl.textContent = opts.title || 'Are you sure?';
  confirmMsgEl.textContent = opts.message || '';
  confirmYesEl.textContent = opts.confirmLabel || 'Yes';
  confirmYesEl.className = 'btn' + (opts.danger === false ? '' : ' btn-danger');
  confirmCallback = opts.onConfirm || null;
  m.hidden = false;
}
function hideConfirm() {
  if (confirmModal) confirmModal.hidden = true;
  confirmCallback = null;
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

// After an email-link landing (signup confirm), the #access_token=...
// fragment has done its job once the session exists. Clear it so the
// URL is clean — but never on a recovery landing, where the form still
// owns the hash until the password is set, and never without a session
// (nothing landed yet).
function clearAuthHashIfLanded() {
  if (!user || isRecoveryUrl()) return;
  try {
    var h = (typeof window !== 'undefined' && window.location) ? (window.location.hash || '') : '';
    if (/access_token=/.test(h)) clearUrlHash();
  } catch (e) { /* a stale hash is cosmetic; the session is what matters */ }
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
  var opts = {};
  if (typeof window !== 'undefined' && window.location && window.location.href) {
    // The confirm link must come back to this app, not to the project's
    // default Site URL (v3.28: the dashboard Site URL is already the
    // app, but an explicit redirect means the link survives a future
    // dashboard change instead of landing on a dead page).
    opts.emailRedirectTo = window.location.href.split('#')[0];
  }
  var res = await sb.auth.signUp({ email: email, password: password, options: opts });
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

// Stay signed in, part 2: if the app opened while offline (or the
// token refresh failed the first time), the first getSession finds
// nothing and the app looks logged out — even though the saved login
// is still in this device's storage. Re-check whenever the app comes
// back online or comes to the front, so a good connection restores
// the login without asking for the password again.
async function refreshSessionIfLoggedOut() {
  if (!sb || user) return;
  try {
    var sess = await sb.auth.getSession();
    if (sess.data && sess.data.session && sess.data.session.user) {
      user = sess.data.session.user;
      subscribeLive();
      await refreshSetsFromCloud();
      renderAuth();
      renderSets();
      updateSyncStatus();
    }
  } catch (e) { /* still logged out; the Log in button stays */ }
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
    if (sb) { toggle.textContent = 'Log in / Sign up'; toggle.disabled = false; }
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

// Structured import errors that a retry cannot fix (v3.25): a bad
// number, a set Rebrickable doesn't have, a missing key, no login, or a
// rate limit the function already waited out. Everything else — a
// thrown network error, or a gateway failure with no error body (the
// 75419-1 import died exactly like that once at the edge after ~35s
// and worked on a manual retry) — gets ONE automatic retry.
var IMPORT_NO_RETRY = { set_not_found: 1, bad_set_num: 1, unauthorized: 1, no_api_key: 1, rate_limited: 1 };
async function invokeImportSet(body, onRetry) {
  var lastRes = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    var res;
    try {
      res = await sb.functions.invoke('import-set', { body: body });
    } catch (e) {
      if (attempt === 0) { if (onRetry) onRetry(); continue; }
      throw e;
    }
    lastRes = res;
    var payload = (res && res.data) || null;
    if (payload && payload.ok) return res;
    var code = (payload && payload.error) || null;
    if (!code) {
      var ctx = (res && res.error && res.error.context) || null;
      code = (ctx && ctx.error) || null;
    }
    if (code && IMPORT_NO_RETRY[code]) return res;
    if (attempt === 0) { if (onRetry) onRetry(); continue; }
    return res;
  }
  return lastRes;
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
    // One automatic retry on a transport/gateway failure (see
    // invokeImportSet) — big sets take ~30s to fetch and the edge
    // killed the first 75419-1 attempt; the retry worked.
    res = await invokeImportSet({ set_num: num }, function () {
      say('Still looking — that one is taking a while, trying once more…');
    });
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

async function addImportedSet(open) {
  var p = pendingImport;
  if (!p) return;
  var msg = $('addSetMsg');
  function say(t) { if (msg) msg.textContent = t; }
  // Register the inventory first: loadCounts/openSet need it right away.
  INVENTORIES[p.set_num] = p.inventory;
  var meta = {
    key: p.set_num, set_num: p.set_num, set_name: p.name, year: p.year || null,
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
  // Suggestions import in the background (v3.36): the set joins My
  // sets without yanking the view away from the optimizer. The Add
  // Set button passes the click event, which is not false, so it
  // still opens the set as before.
  if (open !== false) openSet(meta.key);
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

/* ---------- Swipe in from the left edge (v3.30): phone ----------
 * On a phone the sidebar is a drawer; a swipe starting within 32px
 * of the left edge and moving right opens it, and a left swipe while
 * it is open closes it. Vertical movement is a scroll, not a swipe,
 * so the set list still scrolls. Skipped while the instructions
 * viewer or the 3D lightbox is open (they sit on top of the drawer),
 * and while a set box is being grip-dragged. Works from the
 * installed home-screen icon; in a browser tab the system back-swipe
 * may claim the gesture first. */
var swipeStartX = null, swipeStartY = null;
function swipeModalOpen() {
  if (typeof document.querySelector !== 'function') return false;
  return !!document.querySelector('.instr-viewer:not([hidden]), #lightbox:not([hidden])');
}
function drawerSwipeStart(x, y) { swipeStartX = x; swipeStartY = y; }
function drawerSwipeMove(x, y) {
  if (swipeStartX === null) return;
  if (dragActive) return; // a set reorder owns the gesture
  var dx = x - swipeStartX, dy = y - swipeStartY;
  if (Math.abs(dy) > Math.abs(dx)) return; // scrolling, not swiping
  var open = document.body.classList.contains('drawer-open');
  if (!open && swipeStartX <= 32 && dx > 48 && !swipeModalOpen()) {
    setDrawer(true);
    swipeStartX = null;
  } else if (open && dx < -48) {
    setDrawer(false);
    swipeStartX = null;
  }
}
function drawerSwipeEnd() { swipeStartX = null; swipeStartY = null; }

/* ---------- Drag-handle reorder for My sets (v3.33) ----------
 * The 400ms long-press (v3.30) is gone: it fired while scrolling and
 * fought the drawer swipe. Each row now has a ⋮⋮ grip at its left
 * edge; a press on the grip lifts the row at once, drag it up or down
 * and release to drop it there. A tap on the grip does nothing (the
 * row's click is swallowed); a tap anywhere else on the row still
 * opens the set. The order is the ranking: it decides which set is
 * "first" at startup and the order in the combined view. The order
 * lives in the local sets list, so it is per-device (cloud rows carry
 * no order). */
var dragKey = null, dragLi = null, dragActive = false;
var suppressNextRowClick = false;
function beginSetDrag(s, li) {
  dragKey = s.key;
  dragLi = li;
  dragActive = true;
  li.classList.add('dragging');
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10);
}
function dragMoveTo(clientY) {
  if (!dragActive || !dragKey) return;
  var list = $('setList');
  var rows = list.children;
  var dragged = null;
  var before = null;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.dataset && row.dataset.key === dragKey) { dragged = row; continue; }
    var r = row.getBoundingClientRect();
    if (clientY < r.top + r.height / 2) { before = row; break; }
  }
  if (!dragged) return;
  if (before === dragged.nextSibling) return; // already in that spot
  if (before === null && dragged === rows[rows.length - 1]) return;
  if (before) list.insertBefore(dragged, before);
  else list.appendChild(dragged);
}
function endSetDrag() {
  if (!dragActive) return;
  dragActive = false;
  if (dragLi) dragLi.classList.remove('dragging');
  suppressNextRowClick = true;
  setTimeout(function () { suppressNextRowClick = false; }, 350);
  // Commit: read the row order from the sidebar and reorder `sets`
  // to match, then save. Cloud refresh keeps this order (v3.30).
  var list = $('setList');
  var order = [];
  for (var i = 0; i < list.children.length; i++) {
    var k = list.children[i].dataset && list.children[i].dataset.key;
    if (k) order.push(k);
  }
  if (order.length === sets.length) {
    sets.sort(function (a, b) { return order.indexOf(a.key) - order.indexOf(b.key); });
    saveLocalSets(sets.map(function (s) {
      return { key: s.set_num, set_num: s.set_num, set_name: s.set_name, year: s.year || null, total_parts: s.total_parts, total_lots: s.total_lots, set_img_url: s.set_img_url || null, user_set_id: s.user_set_id || null };
    }));
    renderSets();
  }
  dragKey = null;
  dragLi = null;
}

// Pick exactly these sets (at least one) and show them together.
function setSelected(keys) {
  var valid = keys.filter(function (k) { return findSet(k); });
  if (!valid.length) return;
  bulkViewId = null; // leaving a bulk list view for the set view
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
  // The dropdown counts what the cards show: in a multi-set view the
  // merged pieces, so a colour's number matches its one card.
  viewList().forEach(function (it) {
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
  // The dropdown counts what the cards show: in a multi-set view the
  // merged pieces, so a category's number matches its cards.
  viewList().forEach(function (it) {
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

/* ---------- Batched card rendering (v3.30) ----------
 * The All view used to build every card — and every image — up front,
 * which is why it crawled once the sets passed ~36,000 pieces. Cards
 * now render in batches of CARD_CHUNK as the user scrolls: the first
 * batch shows at once, and the next batch loads when the "Show more"
 * marker scrolls into view (or when its button is tapped). Images
 * already carry loading="lazy", so only on-screen cards fetch photos. */
var CARD_CHUNK = 120;
var viewPending = [];    // ordered items not yet rendered in this view
var viewTierGrids = {};  // tier -> its card-grid element, this view
var viewTierNames = null;
var viewSentinel = null; // the "Show more" footer, kept last in the view
var viewMoreBtn = null;
var viewObserver = null; // IntersectionObserver auto-loading next batches
var TIER_NOTES = {
  1: 'Common bricks and plates — the bulk bins are full of these.',
  2: 'Worth digging for — less common, still in the bins.',
  3: 'Rare in bulk — check the sorted cases and minifig wall too.'
};

/* ---------- Merged cards (v3.32) ----------
 * In a multi-set view, lots with the same part number + colour merge
 * into ONE card with the grand total — like pieces sit together instead
 * of showing once per set. The merge is view-only: `items` stays
 * per-set (the header progress and the cloud sync still count lots),
 * and a single-set view is unchanged — each lot is its own card there.
 * A merged card's tier is the lowest (most likely in bulk) of its lots,
 * its quantity is the summed quantity, and it carries its lots so a tap
 * can still be credited to one set. Cards never name a set. */
function mergeItemsForView() {
  if (selectedKeys.length <= 1) return items;
  var byKey = {};
  var order = [];
  items.forEach(function (it) {
    var pk = partKeyOf(it);
    var m = byKey[pk];
    if (!m) {
      m = { merged: true, id: it.id, setKey: it.setKey, colour: it.colour, dim: it.dim, img: it.img, name: it.name, cat: it.cat, tier: it.tier, qty: 0, lots: [] };
      byKey[pk] = m;
      order.push(m);
    }
    m.qty += it.qty;
    if (it.tier < m.tier) m.tier = it.tier;
    m.lots.push({ setKey: it.setKey, id: it.id, qty: it.qty });
  });
  return order;
}
function viewList() { return mergeItemsForView(); }

// The DOM key of a card: merged cards are keyed by part, single-set
// cards by set + lot id.
function cardKeyFor(item) {
  if (selectedKeys.length > 1) return 'merged|' + partKeyOf(item);
  return item.setKey + '|' + item.id;
}
// The view item a tap or refresh belongs to: in a multi-set view a raw
// lot resolves to its merged card; in a single-set view it is itself.
function viewItemForCard(item) {
  if (selectedKeys.length <= 1) return item;
  var pk = partKeyOf(item);
  var list = viewList();
  for (var i = 0; i < list.length; i++) {
    if (partKeyOf(list[i]) === pk) return list[i];
  }
  return item;
}

function renderSetView() {
  if (bulkViewId) { renderBulkListView(); return; }
  var view = $('setView');
  if (viewObserver) { viewObserver.disconnect(); viewObserver = null; }
  view.innerHTML = '';
  viewPending = [];
  viewTierGrids = {};
  viewSentinel = null;
  viewMoreBtn = null;
  if (!selectedKeys.length || !items.length) { showEmpty(); return; }
  $('emptyState').hidden = true;
  $('progressWrap').hidden = false;

  var h = el('h2', null, setTitle());
  h.style.margin = '4px 0 12px';
  view.appendChild(h);

  // Order remaining (v3.33): the parts still needed as a BrickLink
  // XML wanted list for Rebrickable's import. Export only.
  var orderBtn = el('button', 'btn btn-small order-btn', 'Order remaining');
  orderBtn.type = 'button';
  orderBtn.title = 'Download the parts still needed as a BrickLink XML wanted list for Rebrickable';
  orderBtn.addEventListener('click', function () { showOrderModal(); });
  view.appendChild(orderBtn);

  // Tier names are the same across sets; take them from the first set
  // that has an inventory, so a combined view still names each tier once.
  viewTierNames = { 1: 'MOST LIKELY IN BULK', 2: 'MEDIUM — WORTH A DIG', 3: 'LEAST LIKELY IN BULK' };
  selectedKeys.forEach(function (key) {
    var inv = getInventory(key);
    if (inv && inv.tiers) viewTierNames = inv.tiers;
  });
  // One ordered list, tier 1 then 2 then 3 — the same order the old
  // per-tier banners produced, for single- and multi-set views alike.
  // Cards carry no set tag in a combined view; the set a part came
  // from is needless information there. The list is the merged view
  // (v3.32): one card per like piece when several sets are selected.
  var list = viewList();
  [1, 2, 3].forEach(function (tier) {
    list.forEach(function (it) {
      if (it.tier === tier && cardMatches(it)) viewPending.push(it);
    });
  });
  if (!viewPending.length) {
    view.appendChild(el('p', 'muted', 'No pieces match these filters — try widening the type or colour.'));
  } else {
    renderNextChunk();
    viewSentinel = el('div', 'view-more');
    viewMoreBtn = el('button', 'btn', 'Show more');
    viewMoreBtn.type = 'button';
    viewMoreBtn.addEventListener('click', function () { renderNextChunk(); });
    viewSentinel.appendChild(viewMoreBtn);
    view.appendChild(viewSentinel);
    updateViewMore();
    // Scroll-loading: the next batch arrives when the marker scrolls
    // into view. The button stays as the fallback (and for browsers
    // without IntersectionObserver).
    if (typeof IntersectionObserver !== 'undefined') {
      viewObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) renderNextChunk(); });
      }, { rootMargin: '600px' });
      viewObserver.observe(viewSentinel);
    }
  }

  var impBtn = $('importBtn');
  if (impBtn) impBtn.hidden = selectedKeys.indexOf('8961-1') < 0;
  rebuildColourSelect();
  rebuildTypeSelect();
  renderProgress();
  renderSets(); // sidebar progress numbers
}

// Create a tier's banner + note + grid the first time one of its cards
// is rendered, and return the grid to append to.
function ensureTierSection(tier) {
  if (viewTierGrids[tier]) return viewTierGrids[tier];
  var view = $('setView');
  view.appendChild(el('h3', 'tier-banner tier-' + tier, 'TIER ' + tier + ' — ' + viewTierNames[String(tier)]));
  view.appendChild(el('p', 'tier-note', TIER_NOTES[tier]));
  var grid = el('div', 'card-grid');
  view.appendChild(grid);
  viewTierGrids[tier] = grid;
  return grid;
}

// Render the next batch of cards. The sentinel stays last in the view:
// a new tier's banner + grid go in just above it.
function renderNextChunk() {
  var view = $('setView');
  var n = Math.min(CARD_CHUNK, viewPending.length);
  for (var i = 0; i < n; i++) {
    var it = viewPending.shift();
    ensureTierSection(it.tier).appendChild(buildCard(it));
  }
  if (viewSentinel) view.appendChild(viewSentinel);
  updateViewMore();
}

function updateViewMore() {
  if (!viewSentinel || !viewMoreBtn) return;
  if (!viewPending.length) {
    if (viewObserver) { viewObserver.disconnect(); viewObserver = null; }
    viewSentinel.hidden = true;
    return;
  }
  viewMoreBtn.textContent = 'Show more (' + viewPending.length + ' left)';
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

/* Display colour name -> RGB, for scan colour sampling (v3.36).
 * Values are from Rebrickable's colour table (rebrickable.com/colors,
 * read 2026-11-26) — the same table the import path's colour names
 * come from, so the keys match the names the scan picker offers.
 * Two exceptions: White uses LDraw's #F4F4F4, not Rebrickable's pure
 * #FFFFFF — a photographed white brick reads ~244, and with pure
 * white in the table it would tie with Clear (#FCFCFC) and lose.
 * Trans-Blue has no Rebrickable row of its own; it takes
 * Trans-Dark Blue's #0020A0, the BrickLink-14 colour the picker
 * name stands for. Trans/solid twins share an RGB in this table
 * (Red and Trans-Red are both #C91A09) — a photo's average colour
 * genuinely can't tell them apart, so the sampled pick is the solid
 * twin and the top-3 chips are the one-tap correction. Colours with
 * no entry here are never the sampled pick; the manual picker still
 * offers them. */
var LEGO_COLOUR_RGB = {
  'White': [244, 244, 244], 'Black': [5, 19, 29], 'Blue': [0, 85, 191],
  'Red': [201, 26, 9], 'Dark Grey': [108, 110, 104], 'Light Grey': [160, 165, 169],
  'Tan': [228, 205, 158], 'Orange': [254, 138, 24], 'Yellow': [242, 205, 55],
  'Lime Green': [187, 233, 11], 'Clear': [252, 252, 252],
  'Trans-Blue': [0, 32, 160], 'Trans-Brown': [99, 95, 82],
  'Trans-Green': [132, 182, 141], 'Trans-Orange': [240, 143, 28],
  'Trans-Red': [201, 26, 9],
  'Trans-Yellow': [245, 205, 47], 'Trans-Light Blue': [174, 239, 236],
  'Trans-Dark Blue': [0, 32, 160], 'Trans-Purple': [165, 165, 203],
  'Trans-Pink': [228, 173, 200], 'Trans-Dark Pink': [223, 102, 149],
  'Trans-Bright Green': [217, 228, 167], 'Trans-Neon Green': [248, 241, 132],
  'Trans-Neon Yellow': [218, 176, 0], 'Trans-Neon Orange': [255, 128, 13],
  'Magenta': [146, 57, 120], 'Dark Pink': [200, 112, 160],
  'Bright Pink': [228, 173, 200], 'Light Pink': [254, 204, 207],
  'Pink': [252, 151, 172], 'Coral': [255, 105, 143],
  'Lavender': [225, 213, 237], 'Medium Lavender': [172, 120, 186],
  'Purple': [129, 0, 123], 'Dark Purple': [63, 54, 145],
  'Violet': [67, 84, 163], 'Medium Azure': [54, 174, 191],
  'Dark Azure': [7, 139, 201], 'Bright Light Blue': [159, 195, 233],
  'Medium Blue': [90, 147, 219], 'Dark Blue': [10, 52, 99],
  'Light Blue': [180, 210, 227], 'Sky Blue': [125, 191, 221],
  'Maersk Blue': [53, 146, 195], 'Sand Blue': [96, 116, 161],
  'Sand Green': [160, 188, 172], 'Dark Green': [24, 70, 50],
  'Green': [35, 120, 65], 'Bright Green': [75, 159, 74],
  'Medium Green': [115, 220, 161], 'Light Green': [194, 218, 184],
  'Olive Green': [155, 154, 90], 'Yellowish Green': [223, 238, 165],
  'Medium Lime': [199, 210, 60], 'Light Lime': [217, 228, 167],
  'Dark Tan': [149, 138, 115], 'Reddish Brown': [88, 42, 18],
  'Dark Brown': [53, 33, 0], 'Brown': [88, 57, 39],
  'Nougat': [208, 145, 104], 'Medium Nougat': [170, 125, 85],
  'Light Nougat': [246, 215, 179], 'Dark Nougat': [173, 97, 64],
  'Sand Red': [214, 117, 114], 'Dark Red': [114, 14, 15],
  'Dark Orange': [169, 85, 0], 'Reddish Orange': [202, 76, 11],
  'Bright Light Orange': [248, 187, 61], 'Bright Light Yellow': [255, 240, 58],
  'Light Yellow': [251, 230, 150], 'Warm Gold': [170, 127, 46],
  'Chrome Silver': [224, 224, 224], 'Flat Silver': [137, 135, 136],
  'Metallic Silver': [165, 169, 180], 'Pearl Light Grey': [156, 163, 168],
  'Pearl Dark Grey': [87, 88, 87], 'Glow In Dark White': [217, 217, 217],
  'Copper': [174, 122, 89], 'Dark Turquoise': [0, 143, 155],
  'Aqua': [179, 215, 209], 'Light Aqua': [173, 195, 192],
  'Chrome Gold': [187, 165, 61], 'Metallic Gold': [219, 172, 52],
  'Chrome Blue': [108, 150, 191], 'Chrome Green': [60, 179, 113],
  'Chrome Pink': [170, 77, 142], 'Chrome Black': [27, 42, 52],
  'Speckle Black Silver': [5, 19, 29], 'Speckle Black Copper': [5, 19, 29],
  'Speckle Black Gold': [5, 19, 29], 'Speckle Dark Bluish Grey Silver': [108, 110, 104],
  // Pictured colours: the LEGO segment name (underscores -> spaces)
  // for any-colour lots, which the picker offers as-is.
  'Dark Stone Grey': [108, 110, 104], 'Medium Stone Grey': [160, 165, 169],
  'Very Light Bluish Grey': [230, 227, 224], 'Bright Red': [201, 26, 9],
  'Bright Blue': [0, 85, 191], 'Bright Yellow': [242, 205, 55],
  'Bright Orange': [254, 138, 24], 'Brick Yellow': [228, 205, 158],
  'Transparent': [252, 252, 252], 'Transparent Red': [201, 26, 9],
  'Transparent Bright Orange': [240, 143, 28], 'Transparent Yellow': [245, 205, 47],
  'Transparent Green': [132, 182, 141], 'Transparent Blue': [0, 32, 160],
  'Transparent Dark Blue': [0, 32, 160], 'Transparent Light Blue': [174, 239, 236],
  'Transparent Bright Green': [217, 228, 167],
  'Transparent Fluorescent Green': [248, 241, 132],
  'Transparent Pink': [228, 173, 200],
  'Transparent Medium Red Violet': [141, 115, 179],
  'Transparent Black': [99, 95, 82], 'Transparent Brown': [99, 95, 82],
  'Transparent Fluorescent Red Orange': [255, 128, 13],
  'Transparent Neon Yellow': [218, 176, 0],
  'Bright Light Yellow': [255, 240, 58], 'Bright Yellowish Green': [187, 233, 11],
  'Bright Violet': [129, 0, 123], 'Fabuland Brown': [182, 123, 80]
};

/* LEGO colour name (the 3rd segment of a lot id, e.g. Dark_Stone_Grey)
 * -> BrickLink colour id. Verified against Rebrickable's colour table
 * (rebrickable.com/colors — the BrickLink column; read 2026-11-25).
 * This is the exact mapping the wanted-list export uses, because the
 * display colour is ambiguous: 'Trans-Green' covers both LEGO
 * Transparent_Green (BrickLink 20) and Transparent_Fluorescent_Green
 * (BrickLink 16), and 'Dark Grey' covers Dark_Stone_Grey (85) and
 * Dark_Grey (10). Two LEGO names have no verified BrickLink id and
 * are left out on purpose — Bright_Purple and Medium_Turquoise:
 * lots in those colours are skipped by the export and reported, never
 * guessed. 'Reddish_Brown' is also a known collision: the import
 * transform folds both Rebrickable 'Brown' (old brown, BrickLink 8)
 * and 'Reddish Brown' (modern, BrickLink 88) into this one LEGO name;
 * 88 is used because every set this tracker holds is 2003 or newer.
 * 'Trans-Dark Blue' and 'Trans-Blue' both map to 14 — BrickLink uses
 * the one id for that colour. */
var LEGO_TO_BRICKLINK = {
  'Black': 11, 'White': 1, 'Dark_Stone_Grey': 85, 'Medium_Stone_Grey': 86,
  'Dark_Grey': 10, 'Light_Grey': 9, 'Very_Light_Bluish_Grey': 99,
  'Bright_Red': 5, 'Bright_Blue': 7, 'Bright_Yellow': 3, 'Bright_Orange': 4,
  'Bright_Light_Orange': 110, 'Brick_Yellow': 2, 'Reddish_Brown': 88,
  'Dark_Brown': 120, 'Green': 6, 'Dark_Green': 80, 'Bright_Green': 36,
  'Bright_Yellowish_Green': 34, 'Yellowish_Green': 158, 'Olive_Green': 155,
  'Sand_Green': 48, 'Sand_Blue': 55, 'Medium_Azure': 156, 'Dark_Azure': 153,
  'Bright_Light_Blue': 105, 'Medium_Blue': 42, 'Dark_Blue': 63,
  'Bright_Violet': 43, 'Dark_Purple': 89, 'Medium_Lavender': 157,
  'Magenta': 71, 'Bright_Pink': 104, 'Light_Pink': 56, 'Warm_Gold': 115,
  'Chrome_Silver': 22, 'Flat_Silver': 95, 'Metallic_Silver': 67,
  'Pearl_Light_Grey': 66, 'Pearl_Dark_Grey': 77, 'Glow_In_Dark_White': 159,
  'Transparent': 12, 'Transparent_Red': 17, 'Transparent_Bright_Orange': 98,
  'Transparent_Yellow': 19, 'Transparent_Green': 20, 'Transparent_Blue': 14,
  'Transparent_Dark_Blue': 14, 'Transparent_Light_Blue': 15,
  'Transparent_Bright_Green': 108, 'Transparent_Fluorescent_Green': 16,
  'Transparent_Pink': 107, 'Transparent_Medium_Red_Violet': 51,
  'Transparent_Black': 251, 'Transparent_Brown': 13,
  'Transparent_Fluorescent_Red_Orange': 18, 'Transparent_Neon_Yellow': 121,
  'Chrome_Gold': 21, 'Metallic_Gold': 65, 'Copper': 84, 'Dark_Turquoise': 39,
  'Bright_Light_Yellow': 103, 'Light_Yellow': 33, 'Dark_Orange': 68,
  'Reddish_Orange': 167, 'Coral': 220, 'Medium_Nougat': 150, 'Nougat': 28,
  'Light_Nougat': 90, 'Dark_Nougat': 225, 'Light_Aqua': 152, 'Aqua': 41,
  'Dark_Pink': 47, 'Lavender': 154, 'Sand_Red': 58, 'Fabuland_Brown': 106,
  'Maersk_Blue': 72, 'Chrome_Blue': 52, 'Chrome_Green': 64, 'Chrome_Pink': 82,
  'Chrome_Black': 122, 'Speckle_Black_Silver': 111, 'Speckle_Black_Copper': 116,
  'Speckle_Black_Gold': 151, 'Speckle_Dark_Bluish_Grey_Silver': 117
};

/* ---------- Rebrickable → BrickLink part numbers (v3.35) ----------
 * Joseph hit this live 2026-11-25: BrickLink rejected 18 lines from
 * a pasted XML export — "items in the XML file are invalid or do not
 * exist in the BrickLink Catalog." The export used Rebrickable part
 * numbers, and for these 14 parts Rebrickable's number is not
 * BrickLink's. Most Rebrickable numbers ARE BrickLink numbers, so a
 * part not in this map passes through unchanged; an entry here is a
 * plain BrickLink id for a renumber / mold split (3747b, 60470b), a
 * per-colour minifig map (the rock monsters: BrickLink sells the
 * whole monster as a minifig, pm002–pm005, keyed by the LEGO colour
 * segment — Trans-Red Meltrox pm003, Trans-Blue Glaciator pm004,
 * Trans-Bright-Orange Firox pm002, Trans-Fluorescent-Green Sulfurix
 * pm005; LEGO elements 4538017 / 4541465 / 4541468 / 4541475), or a
 * quantity multiplier (the chain: Rebrickable 60169 is a 16-long
 * chain of 21 links; BrickLink 3711 is sold per link, so one chain
 * orders 21 — over-ordering links is harmless spares, under-ordering
 * would leave the chain short). A part whose BrickLink id can't be
 * determined (a rock monster in a colour with no known minifig) is
 * skipped and reported, never exported blindly. */
var REBRICKABLE_TO_BRICKLINK = {
  '30367': '553', '30385': '52', '30499': '3684', '3747': '3747b',
  '41669': 'x346', '54196': '2654', '60169': { id: '3711', qtyMult: 21 },
  '60470': '60470b', '60779': '2335', '6143': '3941',
  '64786': { minifigByColour: { 'Transparent_Red': 'pm003', 'Transparent_Blue': 'pm004', 'Transparent_Bright_Orange': 'pm002', 'Transparent_Fluorescent_Green': 'pm005' } },
  '73587': '4592c02', '86209': '60601', '88072': '4623a'
};

// The BrickLink identity for one inventory lot, or a skip reason.
// Returns { id, type, colour, qty }: type 'P' for parts, 'M' for
// minifigs (a BrickLink wanted list takes minifigs with colour 0);
// qty is the remaining count, times any per-link multiplier. A
// return of { skip: reason } means the lot can't be represented on
// BrickLink and the caller must report it, not export it.
function brickLinkPartFor(lot, rem) {
  var part = partNumOf(lot);
  var entry = REBRICKABLE_TO_BRICKLINK[part];
  if (entry && typeof entry === 'object' && entry.minifigByColour) {
    var pm = entry.minifigByColour[legoSegOf(lot)];
    if (!pm) return { skip: 'rock monster in ' + displayColour(lot) + ' — no known BrickLink minifig number' };
    return { id: pm, type: 'M', colour: 0, qty: rem };
  }
  var bl = brickLinkColourId(lot);
  if (bl === undefined) return { skip: 'no BrickLink colour id for this colour' };
  if (entry && typeof entry === 'object' && entry.qtyMult) {
    return { id: entry.id, type: 'P', colour: bl, qty: rem * entry.qtyMult };
  }
  return { id: (typeof entry === 'string') ? entry : part, type: 'P', colour: bl, qty: rem };
}

// The LEGO colour name in the lot id (3rd segment). For "any colour"
// lots this is the colour pictured in the photo.
function legoSegOf(item) {
  var parts = String(item.id || '').split('-');
  return parts.length > 2 ? parts[2] : '';
}

// BrickLink colour id for a lot, from the exact LEGO colour in the
// lot id. Returns undefined when the colour has no verified id —
// there is deliberately NO fallback to the display colour: the
// display colour is derived from the same LEGO name, so it adds no
// information, and for a genuinely unknown colour (the 2634 lot's
// {Not_Specified}, whose display field says White) a fallback would
// order the wrong colour.
function brickLinkColourId(item) {
  return LEGO_TO_BRICKLINK[legoSegOf(item)];
}

// The alternate photo for a card whose primary image is dead.
// Sticker sheets live on BrickLink under the set's sheet number
// (8960stk01), not the LEGO part number; everything else uses the
// part number in the lot's colour. Returns '' when there is no
// alternate to try (unknown colour).
function fallbackImg(item) {
  if (item.cat === 'Stickers') {
    return 'https://img.bricklink.com/ItemImage/PN/0/' + String(item.setKey || '').split('-')[0] + 'stk01.png';
  }
  var bl = brickLinkColourId(item);
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
  } else if (typeof window !== 'undefined') {
    window.__bfPendingInstr = { set: setNum, name: setName || setNum };
  } else {
    return;
  }
  openBuildPanel(setNum, setName || setNum);
}

/* ---------- Build list panel (v3.28) ----------
 * The store workflow: a set comes in, they flip through the
 * instructions and tap what the rebuild needs, then go dig bulk with
 * the list. The panel is a mini tracker down the left side of the
 * instructions viewer, grouped by type then colour — no endless
 * scroll, no PDF colour-reading (pixels can't tell a brick from a
 * plate). Every row has a small photo and + / − to add a need.
 * Needs ARE the tracker's remaining counts (changeRemaining), so when
 * they exit the instructions the main view shows exactly what is
 * still needed — no second list to keep in sync. "Mark all complete"
 * resets the set to all-found (asks first) and is the starting point
 * for a rebuild: everything starts as have-it, taps add the needs. */
var buildPanel = null;
var buildToggleBtn = null;
var buildSetNum = null;
var buildSetName = '';
var buildDirty = false;
// v3.29 — the panel's own All colours / All types filters. They are
// the source of truth across re-renders; a different set resets them
// (its colours and types differ), the same set keeps them.
var buildColourFilter = 'all';
var buildTypeFilter = 'all';
var buildColourSelectEl = null;
var buildTypeSelectEl = null;
function openBuildPanel(setNum, setName) {
  if (buildSetNum !== setNum) { buildColourFilter = 'all'; buildTypeFilter = 'all'; }
  buildSetNum = setNum;
  buildSetName = setName || setNum;
  var viewer = $('instrViewer');
  if (!viewer) return;
  if (!buildToggleBtn) {
    buildToggleBtn = document.createElement('button');
    buildToggleBtn.type = 'button';
    buildToggleBtn.className = 'instr-build-btn';
    buildToggleBtn.textContent = 'Build list';
    buildToggleBtn.addEventListener('click', function () { toggleBuildPanel(); });
    viewer.appendChild(buildToggleBtn);
  }
  if (!buildPanel) {
    buildPanel = document.createElement('div');
    buildPanel.className = 'instr-build-panel';
    viewer.appendChild(buildPanel);
  }
  // Wide screen: the list docks open next to the pages. Phone: it
  // starts closed under the Build list button.
  var narrow = (typeof window !== 'undefined' && window.innerWidth && window.innerWidth < 700);
  setBuildPanelOpen(!narrow);
  renderBuildPanel();
}
function setBuildPanelOpen(open) {
  var viewer = $('instrViewer');
  if (!viewer || !buildPanel) return;
  buildPanel.hidden = !open;
  if (viewer.classList) viewer.classList.toggle('build-open', open);
}
function toggleBuildPanel() {
  if (!buildPanel) return;
  setBuildPanelOpen(buildPanel.hidden);
}
function renderBuildPanel() {
  if (!buildPanel || !buildSetNum) return;
  var inv = getInventory(buildSetNum);
  buildPanel.innerHTML = '';
  buildPanel.appendChild(el('h3', 'build-panel-title', 'Build list — ' + buildSetName));
  if (!inv) {
    buildPanel.appendChild(el('p', 'build-panel-need', 'No parts list for this set yet.'));
    return;
  }
  var lots = inv.items.map(function (lot) {
    var copy = {}; for (var k in lot) copy[k] = lot[k];
    copy.setKey = buildSetNum;
    return copy;
  });
  var totalNeed = 0;
  lots.forEach(function (lot) { totalNeed += remOf(lot); });
  buildPanel.appendChild(el('p', 'build-panel-need', totalNeed === 0 ? 'Nothing needed — everything is complete.' : 'Need ' + totalNeed + (totalNeed === 1 ? ' piece' : ' pieces')));
  // v3.29 — the same All colours / All types dropdowns as the main
  // view, but they filter this panel's rows. Raw types and exact
  // colours, matching the group headers below (not the main view's
  // folded display types or colour families). The "Need N pieces"
  // line above stays the whole set's total; the filters only narrow
  // which rows show, and Mark all complete still acts on the set.
  var filters = el('div', 'build-filters');
  buildColourSelectEl = document.createElement('select');
  buildColourSelectEl.setAttribute('aria-label', 'Filter build list by colour');
  buildColourSelectEl.addEventListener('change', function () { buildColourFilter = buildColourSelectEl.value; renderBuildPanel(); });
  buildTypeSelectEl = document.createElement('select');
  buildTypeSelectEl.setAttribute('aria-label', 'Filter build list by type');
  buildTypeSelectEl.addEventListener('change', function () { buildTypeFilter = buildTypeSelectEl.value; renderBuildPanel(); });
  filters.appendChild(buildColourSelectEl);
  filters.appendChild(buildTypeSelectEl);
  buildPanel.appendChild(filters);
  rebuildBuildFilterSelects(lots);
  var shown = lots.filter(function (lot) {
    if (buildTypeFilter !== 'all' && itemCat(lot) !== buildTypeFilter) return false;
    if (buildColourFilter !== 'all' && (lot.colour || 'Any colour') !== buildColourFilter) return false;
    return true;
  });
  if (!shown.length) {
    buildPanel.appendChild(el('p', 'build-no-match', 'No pieces match these filters.'));
  }
  var markBtn = el('button', 'btn build-mark-all', 'Mark all complete');
  markBtn.type = 'button';
  markBtn.addEventListener('click', function () {
    showConfirm({
      title: 'Mark everything complete?',
      message: 'This marks every piece in ' + buildSetName + ' as found — any pieces on the need list will be cleared.',
      confirmLabel: 'Mark all complete',
      danger: false,
      onConfirm: function () { markSetComplete(buildSetNum); }
    });
  });
  buildPanel.appendChild(markBtn);
  // Group by type, then colour, in first-seen order. Raw types here
  // (itemCat), not the folded display types — a rebuild list must keep
  // its structure even when every lot of a type is already complete.
  // Grouped from `shown`, the filter's cut of the lots.
  var types = [];
  var byType = {};
  shown.forEach(function (lot) {
    var t = itemCat(lot);
    if (!byType[t]) { byType[t] = []; types.push(t); }
    byType[t].push(lot);
  });
  types.forEach(function (t) {
    buildPanel.appendChild(el('div', 'build-type', t));
    var colours = [];
    var byColour = {};
    byType[t].forEach(function (lot) {
      var c = lot.colour || 'Any colour';
      if (!byColour[c]) { byColour[c] = []; colours.push(c); }
      byColour[c].push(lot);
    });
    colours.forEach(function (c) {
      buildPanel.appendChild(el('div', 'build-colour', c));
      byColour[c].forEach(function (lot) { buildPanel.appendChild(buildRow(lot)); });
    });
  });
  var closeBtn = el('button', 'btn btn-quiet build-mark-all', 'Close build list');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', function () { setBuildPanelOpen(false); });
  buildPanel.appendChild(closeBtn);
}
function fillBuildFilterSelect(sel, allLabel, values, left, current) {
  sel.innerHTML = '';
  var optAll = el('option', null, allLabel);
  optAll.value = 'all';
  sel.appendChild(optAll);
  values.forEach(function (v) {
    var o = el('option', null, v + ' · ' + (left[v] || 0) + ' left');
    o.value = v;
    sel.appendChild(o);
  });
  // Keep the previous selection if this set still has it; a different
  // set (or a cleared need) falls back to All.
  sel.value = (current === 'all' || (left[current] !== undefined)) ? current : 'all';
}
function rebuildBuildFilterSelects(lots) {
  if (!buildColourSelectEl || !buildTypeSelectEl) return;
  var colourLeft = {};
  var typeLeft = {};
  lots.forEach(function (lot) {
    var c = lot.colour || 'Any colour';
    var t = itemCat(lot);
    colourLeft[c] = (colourLeft[c] || 0) + remOf(lot);
    typeLeft[t] = (typeLeft[t] || 0) + remOf(lot);
  });
  // Options in first-seen order, like the groups below. Every value
  // the set has is listed even at 0 left — the panel shows complete
  // lots too, so a filter must be able to pick them.
  fillBuildFilterSelect(buildColourSelectEl, 'All colors', Object.keys(colourLeft), colourLeft, buildColourFilter);
  fillBuildFilterSelect(buildTypeSelectEl, 'All types', Object.keys(typeLeft), typeLeft, buildTypeFilter);
  buildColourFilter = buildColourSelectEl.value;
  buildTypeFilter = buildTypeSelectEl.value;
}
function buildRow(lot) {
  var row = el('div', 'build-row');
  var rem = remOf(lot);
  if (rem === 0) row.className += ' need-none';
  if (lot.img) {
    var img = document.createElement('img');
    img.src = lot.img; img.alt = '';
    img.addEventListener('error', function () { img.style.display = 'none'; });
    row.appendChild(img);
  }
  var text = el('div', 'build-row-text');
  text.appendChild(el('div', 'build-row-name', lot.name || ('Part ' + partNumOf(lot))));
  text.appendChild(el('div', 'build-row-meta', (lot.colour || '') + ' · Part ' + partNumOf(lot) + ' · ×' + lot.qty + ' in set'));
  row.appendChild(text);
  row.appendChild(el('div', 'build-row-need', 'Need ' + rem));
  var minus = el('button', 'build-step-btn', '−');
  minus.type = 'button';
  minus.setAttribute('aria-label', 'One fewer needed');
  minus.disabled = rem === 0;
  minus.addEventListener('click', function () { buildStep(lot, -1); });
  var plus = el('button', 'build-step-btn', '+');
  plus.type = 'button';
  plus.setAttribute('aria-label', 'Need one more');
  plus.disabled = rem === lot.qty;
  plus.addEventListener('click', function () { buildStep(lot, +1); });
  row.appendChild(minus);
  row.appendChild(plus);
  return row;
}
function buildStep(lot, delta) {
  changeRemaining(lot, delta);
  buildDirty = true;
  renderBuildPanel();
}
function markSetComplete(setNum) {
  var inv = getInventory(setNum);
  if (!inv) return;
  var map = {};
  inv.items.forEach(function (it) { map[it.id] = 0; });
  remainingBySet[setNum] = map;
  saveCounts(setNum, map);
  var meta = findSet(setNum);
  if (meta && meta.user_set_id) enqueueBulkSync(meta);
  buildDirty = true;
  renderSets();
  renderProgress();
  renderBuildPanel();
}
// The instructions viewer lives in its own module; it calls this hook
// when it closes, so the main view behind it shows the build edits.
window.__bfOnInstrClose = function () {
  if (!buildDirty) return;
  buildDirty = false;
  renderSetView();
};

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
  card.dataset.key = cardKeyFor(item);

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
  minus.addEventListener('click', function () { onFoundTap(item); });
  var plus = el('button', null, '+');
  plus.type = 'button';
  plus.setAttribute('aria-label', 'Undo one found piece');
  plus.disabled = rem === item.qty;
  plus.addEventListener('click', function () { changeRemaining(item, +1); });
  var left = el('span', 'left', leftText(item));
  counter.appendChild(minus);
  counter.appendChild(left);
  counter.appendChild(plus);
  card.appendChild(counter);
  return card;
}

// v3.29/v3.32 — a card in the All view shows the piece's grand total
// across every selected set, not just its own set's numbers: one physical
// piece can be needed by several sets, and the number on the card is
// the whole hunt for that piece. Since v3.32 the card IS the merged
// piece, so this sum is the card's own total. A part in a single set
// is unchanged (the sum is just that lot). The buttons stay per-set —
// minus routes through the hunting preference / chooser, plus undoes
// the most recent find for the piece.
function combinedLeft(item) {
  var pk = partKeyOf(item);
  var rem = 0, qty = 0;
  items.forEach(function (it) {
    if (partKeyOf(it) !== pk) return;
    rem += remOf(it);
    qty += it.qty;
  });
  return { rem: rem, qty: qty };
}
function leftText(item) {
  var c = combinedLeft(item);
  return c.rem === 0 ? '✓ 0 of ' + c.qty + ' — done' : c.rem + ' of ' + c.qty + ' left';
}

// The set a merged card's most recent find went to, per piece — the
// plus button undoes that find, not the first set's lot.
var lastMinusSet = {};

// The first lot of this piece in a set that still has room to undo
// (a find was taken from it), or null.
function lotWithRoom(setKey, pk) {
  var out = null;
  items.forEach(function (it) {
    if (out) return;
    if (it.setKey === setKey && partKeyOf(it) === pk && remOf(it) < it.qty) out = it;
  });
  return out;
}

// Which lot a merged card's plus undoes: the set of the last find
// first, then the hunting preference's set, then the first lot with
// room — so the undo always lands where a find came from.
function undoTargetFor(mergedItem) {
  var pk = partKeyOf(mergedItem);
  var tryKeys = [];
  if (lastMinusSet[pk]) tryKeys.push(lastMinusSet[pk]);
  var pref = loadHuntPrefs()[pk];
  if (pref && tryKeys.indexOf(pref) < 0) tryKeys.push(pref);
  mergedItem.lots.forEach(function (lot) {
    if (tryKeys.indexOf(lot.setKey) < 0) tryKeys.push(lot.setKey);
  });
  for (var i = 0; i < tryKeys.length; i++) {
    var lot = lotWithRoom(tryKeys[i], pk);
    if (lot) return lot;
  }
  return null;
}

// Pieces of this part still to find in one set, across all its lots
// of the part (a set can hold the same part in two lots).
function setRemForPart(setKey, pk) {
  var total = 0;
  var inv = getInventory(setKey);
  if (!inv) return 0;
  inv.items.forEach(function (lot) {
    if (partNumOf(lot) + '|' + (lot.colour || '') !== pk) return;
    var copy = {};
    for (var k in lot) copy[k] = lot[k];
    copy.setKey = setKey;
    total += remOf(copy);
  });
  return total;
}

// One tap: device first, cloud second. Never wipes local on sync failure.
function changeRemaining(item, delta) {
  if (item.merged) {
    // A merged card has no lot of its own: minus routes through the
    // hunting preference / chooser, plus undoes the most recent find.
    if (delta < 0) { onFoundTap(item); return; }
    var target = undoTargetFor(item);
    if (target) changeRemaining(target, +1);
    return;
  }
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

/* ---------- Hunting preference (v3.28) ----------
 * In the All view one physical piece can be needed by several sets.
 * Tapping minus on a card asks which set it goes to — unless the
 * answer is already known:
 * - one set still needs it: no popup, it just goes down there;
 * - two or more: a chooser pops up with a Hunting preference at the
 *   top. Pick a set and finds of that piece keep going there until
 *   that set's need for the piece is complete; then the preference
 *   clears and the next find asks again (or goes straight down if
 *   only one set is left needing it). The preference is per piece
 *   (part number + colour), saved on this device. */
function loadHuntPrefs() { return LS.get('bf:huntPrefs', {}); }
function saveHuntPrefs(prefs) { LS.set('bf:huntPrefs', prefs); }
function partKeyOf(item) { return partNumOf(item) + '|' + (item.colour || ''); }

// Lots in the selected sets that still need this exact piece — one
// entry per set, with the set's total need for the piece (a set can
// hold the same part in two lots; the chooser must not list it twice).
function setsNeedingPart(item) {
  var pk = partKeyOf(item);
  var out = [];
  var bySet = {};
  selectedKeys.forEach(function (key) {
    var inv = getInventory(key);
    if (!inv) return;
    inv.items.forEach(function (lot) {
      if (partNumOf(lot) + '|' + (lot.colour || '') !== pk) return;
      var copy = {};
      for (var k in lot) copy[k] = lot[k];
      copy.setKey = key;
      var rem = remOf(copy);
      if (rem <= 0) return;
      var entry = bySet[key];
      if (!entry) {
        var meta = findSet(key);
        entry = { setKey: key, setName: (meta && meta.set_name) || key, lot: copy, rem: 0 };
        bySet[key] = entry;
        out.push(entry);
      }
      entry.rem += rem;
    });
  });
  return out;
}

var huntChooser = null;
var huntChoiceList = null;
var huntChooserItem = null;
function hideHuntChooser() {
  if (huntChooser) huntChooser.hidden = true;
  huntChooserItem = null;
}
function applyFoundTo(candidate) {
  // One find credited to this set's lot of the piece.
  changeRemaining(candidate.lot, -1);
  var pk = partKeyOf(candidate.lot);
  lastMinusSet[pk] = candidate.setKey;
  // Preference spent once that SET's need for the piece is complete
  // (all its lots of the piece), not just the one lot.
  if (setRemForPart(candidate.setKey, pk) === 0) {
    var prefs = loadHuntPrefs();
    if (prefs[pk]) { delete prefs[pk]; saveHuntPrefs(prefs); }
  }
}
function showHuntChooser(item, candidates) {
  huntChooserItem = item;
  if (!huntChooser) {
    var overlay = document.createElement('div');
    overlay.className = 'confirm-modal hunt-chooser';
    overlay.hidden = true;
    var box = document.createElement('div');
    box.className = 'confirm-box';
    var title = document.createElement('h3');
    title.textContent = 'Which set is this piece for?';
    box.appendChild(title);
    var sub = document.createElement('p');
    sub.textContent = 'This piece is still needed by more than one set.';
    box.appendChild(sub);
    var prefLabel = document.createElement('div');
    prefLabel.className = 'hunt-pref-label';
    prefLabel.textContent = 'Hunting preference';
    box.appendChild(prefLabel);
    huntChoiceList = document.createElement('div');
    box.appendChild(huntChoiceList);
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', hideHuntChooser);
    box.appendChild(cancel);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) hideHuntChooser(); });
    document.body.appendChild(overlay);
    huntChooser = overlay;
  }
  huntChoiceList.innerHTML = '';
  candidates.forEach(function (c) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'hunt-choice';
    btn.textContent = c.setName;
    var need = document.createElement('span');
    need.className = 'hunt-need';
    need.textContent = 'needs ' + c.rem;
    btn.appendChild(need);
    btn.addEventListener('click', function () {
      var prefs = loadHuntPrefs();
      prefs[partKeyOf(item)] = c.setKey;
      saveHuntPrefs(prefs);
      hideHuntChooser();
      applyFoundTo(c);
    });
    huntChoiceList.appendChild(btn);
  });
  huntChooser.hidden = false;
}

// Minus tap: the piece may be needed by several sets in the All view.
function onFoundTap(item) {
  if (selectedKeys.length <= 1) { changeRemaining(item, -1); return; }
  var candidates = setsNeedingPart(item);
  if (!candidates.length) return; // nothing left to find (button is disabled)
  if (candidates.length === 1) { applyFoundTo(candidates[0]); return; }
  var pk = partKeyOf(item);
  var pref = loadHuntPrefs()[pk];
  if (pref) {
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].setKey === pref) { applyFoundTo(candidates[i]); return; }
    }
  }
  showHuntChooser(item, candidates);
}

function updateCardUI(item) {
  rebuildCatCounts(); // the tap may have opened or closed a folded section
  // One card per like piece in a multi-set view (v3.32), so one refresh
  // moves its grand total — no sibling cards to chase anymore.
  updateOneCard(item);
  rebuildColourSelect();
  rebuildTypeSelect();
}
function updateOneCard(item) {
  // The card this tap belongs to: in a multi-set view a raw lot
  // resolves to its merged card, whose numbers are the grand totals.
  var view = viewItemForCard(item);
  var rem = remOf(view);
  var card = document.querySelector('.card[data-key="' + CSS.escape(cardKeyFor(view)) + '"]');
  if (!card) return; // card hidden by the current filter; progress still updated
  card.classList.toggle('done', rem === 0);
  var left = card.querySelector('.left');
  if (left) left.textContent = leftText(view);
  var btns = card.querySelectorAll('.counter button');
  if (btns[0]) btns[0].disabled = rem === 0;
  if (btns[1]) btns[1].disabled = rem === view.qty;
  // If the tap moved the card out of the active filter, hide it.
  if (!cardMatches(view)) card.style.display = 'none';
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
  // Floored, not rounded (v3.29): 100% means truly complete — one
  // piece back on the need list must drop the number to 99%. Rounded,
  // 429 of 430 still read 100% and the sidebar never moved.
  return Math.floor((found / setMeta.total_parts) * 100) + '%';
}

/* ---------- Delete a set (v3.28) ----------
 * The X on a My sets row asks once, then wipes the set everywhere:
 * local list + counts + instructions position + cloud ids + hunting
 * prefs + queued sync ops, and the cloud user_sets + set_parts rows.
 * The shared set_inventories cache stays — re-adding the set later is
 * instant. If the cloud wipe can't run (offline, or the delete fails),
 * a tombstone is saved and the wipe is retried on the next sync; the
 * pull skips tombstoned sets so a deleted set can never come back. */
function deletedSets() { return LS.get('bf:deletedSets', {}); }
function saveDeletedSets(map) { LS.set('bf:deletedSets', map); }

async function deleteCloudSet(userSetId) {
  if (!sb || !user || !userSetId) return false;
  try {
    var parts = await sb.from('set_parts').delete().eq('user_set_id', userSetId);
    if (parts.error) return false;
    var row = await sb.from('user_sets').delete().eq('id', userSetId);
    if (row.error) return false;
    return true;
  } catch (e) { return false; }
}

async function retryDeletedSets() {
  if (!sb || !user) return;
  var tombs = deletedSets();
  var ids = Object.keys(tombs);
  if (!ids.length) return;
  var left = {};
  for (var i = 0; i < ids.length; i++) {
    var ok = await deleteCloudSet(ids[i]);
    if (!ok) left[ids[i]] = tombs[ids[i]];
  }
  saveDeletedSets(left);
}

async function deleteSet(meta) {
  var key = meta.key || meta.set_num;
  var setNum = meta.set_num || meta.key;
  var userSetId = meta.user_set_id || (cloudIds()[setNum] || null);
  // Local wipe first: the set is gone from this device either way.
  sets = sets.filter(function (s) { return (s.key || s.set_num) !== key; });
  saveLocalSets(sets);
  LS.remove(countsKey(setNum));
  LS.remove(instrPosKey(setNum));
  var ids = cloudIds();
  if (ids[setNum]) { delete ids[setNum]; saveCloudIds(ids); }
  var prefs = loadHuntPrefs();
  var prefsChanged = false;
  Object.keys(prefs).forEach(function (pk) { if (prefs[pk] === key) { delete prefs[pk]; prefsChanged = true; } });
  if (prefsChanged) saveHuntPrefs(prefs);
  if (userSetId) {
    saveOutbox(outbox().filter(function (op) { return op.user_set_id !== userSetId; }));
  }
  // Cloud wipe, best effort; a tombstone retries it later.
  if (userSetId) {
    var wiped = await deleteCloudSet(userSetId);
    if (!wiped) {
      var tombs = deletedSets();
      tombs[userSetId] = { set_num: setNum };
      saveDeletedSets(tombs);
    }
  }
  // Selection fallback: another selected set takes over, or the first
  // set in the list; nothing left means the empty state.
  selectedKeys = selectedKeys.filter(function (k) { return k !== key; });
  saveSelectedKeys();
  if (activeSetKey === key) {
    activeSetKey = selectedKeys.length ? selectedKeys[0] : (sets.length ? sets[0].key : null);
    if (activeSetKey) LS.set('bf:activeSet', activeSetKey);
    else LS.remove('bf:activeSet');
  }
  if (selectedKeys.length) loadSelected();
  else { items = []; remainingBySet = {}; }
  renderSets();
  renderSetView();
  updateSyncStatus();
}

function renderSets() {
  var list = $('setList');
  list.innerHTML = '';
  $('noSetsMsg').hidden = sets.length > 0;
  $('seedBtn').style.display = findSet('8961-1') ? 'none' : '';
  refreshImportButtons();
  sets.forEach(function (s) {
    var li = el('li', selectedKeys.indexOf(s.key) >= 0 ? 'active' : '');
    li.dataset.key = s.key;
    // ⋮⋮ grip at the row's left edge: press it and the row lifts at
    // once for a reorder drag (v3.33). A tap on the grip does nothing.
    var grip = el('button', 'set-drag-handle', '⋮⋮');
    grip.type = 'button';
    grip.setAttribute('aria-label', 'Drag to reorder ' + (s.set_name || s.set_num));
    grip.addEventListener('pointerdown', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      beginSetDrag(s, li);
    });
    grip.addEventListener('click', function (e) { e.stopPropagation(); });
    li.appendChild(grip);
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
    // X on the row, right of the picture: delete the set (asks first).
    var delBtn = el('button', 'set-del-btn', '×');
    delBtn.type = 'button';
    delBtn.setAttribute('aria-label', 'Delete ' + (s.set_name || s.set_num));
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation(); // don't also open the set
      showConfirm({
        title: 'Delete this set?',
        message: 'This removes ' + (s.set_name || s.set_num) + ' (' + s.set_num + ') and all its saved counts from this device and your account. You can add it again later.',
        confirmLabel: 'Delete',
        onConfirm: function () { deleteSet(s); }
      });
    });
    li.appendChild(delBtn);
    li.addEventListener('click', function () {
      // A tap right after a grip drag ends is the drag's own
      // release, not an open — swallow it (v3.33).
      if (suppressNextRowClick) { suppressNextRowClick = false; return; }
      openSet(s.key);
    });
    list.appendChild(li);
  });
  renderSetPicker();
  renderBulkLists();
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

/* ---------- Bulk lists + camera scan + optimizer + order remaining (v3.33) ----------
 * Bulk lists are local-only (bf:bulkLists): a named pile of scanned
 * pieces, one row per part + colour. The camera names the part with
 * Brickognize (POST api.brickognize.com/predict/parts/, keyless, ~1
 * req/sec, response { items: [{ id, name, score }] } — no colour, so
 * the confirm card has a colour picker). The piece is added the
 * moment it is identified; Cancel on the confirm card takes it back
 * out. The optimizer ranks the tracked sets against a bulk list by
 * pieces covered or by newest year; price ranking is a disabled
 * "not connected yet" state until a price source is wired. "Order
 * remaining" exports the parts still needed as BrickLink XML for
 * Rebrickable's wanted-list import. */
var bulkLists = [];
var bulkViewId = null; // id of the bulk list open in the main view, or null
var bulkOptWrap = null;
var bulkOptPriceBtn = null;
var bulkOptSort = 'pieces';
// Price ranking for the optimizer runs through the get-prices Edge
// Function, which prices the remaining parts through BrickOwl and
// returns USD totals (v3.36: the key lives in the function, never in
// the browser). The spend-budget toggle is still omitted: ranking by
// cheapest to complete is the price mode.
var OPTIMIZER_PRICE_MODE = 'brickowl';

function loadBulkLists() {
  var v = LS.get('bf:bulkLists', []);
  if (!Array.isArray(v)) return [];
  return v.filter(function (l) { return l && typeof l.id === 'string' && Array.isArray(l.parts); });
}
function saveBulkLists() { LS.set('bf:bulkLists', bulkLists); }
function findBulkList(id) {
  for (var i = 0; i < bulkLists.length; i++) if (bulkLists[i].id === id) return bulkLists[i];
  return null;
}
function bulkListPieces(l) {
  return (l.parts || []).reduce(function (a, p) { return a + p.qty; }, 0);
}
function createBulkList(name) {
  var l = { id: 'bl-' + Date.now() + '-' + Math.floor(Math.random() * 1000), name: name, created: Date.now(), parts: [] };
  bulkLists.push(l);
  saveBulkLists();
  renderBulkLists();
  return l;
}
function deleteBulkList(id) {
  bulkLists = bulkLists.filter(function (l) { return l.id !== id; });
  saveBulkLists();
  if (bulkViewId === id) { bulkViewId = null; loadSelected(); }
  else renderBulkLists();
}
// BrickLink photo for a scanned part in a display colour, when the
// colour maps; '' otherwise (the row shows without a photo).
function bulkPartImg(part, colour) {
  var bl = BRICKLINK_COLOUR[colour];
  if (bl === undefined) return '';
  return 'https://img.bricklink.com/ItemImage/PN/' + bl + '/' + part + '.png';
}
function bulkListQty(list, part, colour) {
  if (!list) return 0;
  var n = 0;
  (list.parts || []).forEach(function (p) { if (p.part === part && p.colour === colour) n += p.qty; });
  return n;
}
function addScannedPart(listId, part, name, colour) {
  var list = findBulkList(listId);
  if (!list) return null;
  var ex = null;
  list.parts.forEach(function (p) { if (p.part === part && p.colour === colour) ex = p; });
  if (ex) ex.qty++;
  else list.parts.push({ part: part, name: name || '', colour: colour, qty: 1, img: bulkPartImg(part, colour) });
  saveBulkLists();
  renderBulkLists();
  return list;
}
function removeScannedPart(listId, part, colour, n) {
  var list = findBulkList(listId);
  if (!list) return;
  n = (n === undefined) ? 1 : n;
  for (var i = 0; i < list.parts.length; i++) {
    var p = list.parts[i];
    if (p.part === part && p.colour === colour) {
      p.qty -= n;
      if (p.qty <= 0) list.parts.splice(i, 1);
      break;
    }
  }
  saveBulkLists();
  renderBulkLists();
  if (bulkViewId === listId) renderBulkListView();
}
function setScannedQty(listId, part, colour, qty) {
  var list = findBulkList(listId);
  if (!list) return;
  for (var i = 0; i < list.parts.length; i++) {
    var p = list.parts[i];
    if (p.part === part && p.colour === colour) {
      if (qty <= 0) list.parts.splice(i, 1);
      else p.qty = qty;
      break;
    }
  }
  saveBulkLists();
  renderBulkLists();
  if (bulkViewId === listId) renderBulkListView();
}

// Colours the picker offers: the app's known display colours, plus
// every colour that appears in the tracked sets' inventories — the
// exact vocabulary the optimizer can match against.
function scanColourOptions() {
  var seen = {};
  var out = [];
  Object.keys(BRICKLINK_COLOUR).forEach(function (c) { if (!seen[c]) { seen[c] = 1; out.push(c); } });
  sets.forEach(function (s) {
    var inv = getInventory(s.set_num);
    if (!inv) return;
    inv.items.forEach(function (it) {
      var c = it.colour || '';
      if (c && !seen[c]) { seen[c] = 1; out.push(c); }
      if (it.any) {
        var pc = picturedColour(it);
        if (pc && !seen[pc]) { seen[pc] = 1; out.push(pc); }
      }
    });
  });
  out.sort();
  return out;
}

function renderBulkLists() {
  var list = $('bulkList');
  if (!list) return;
  list.innerHTML = '';
  var noMsg = $('noBulkMsg');
  if (noMsg) noMsg.hidden = bulkLists.length > 0;
  bulkLists.forEach(function (l) {
    var li = el('li', bulkViewId === l.id ? 'active' : '');
    var text = el('div', 'set-text');
    text.appendChild(el('div', 'set-name', l.name));
    text.appendChild(el('div', 'set-num', bulkListPieces(l) + ' pieces · ' + l.parts.length + ' lots'));
    li.appendChild(text);
    li.addEventListener('click', function () { openBulkList(l.id); });
    list.appendChild(li);
  });
}

function openBulkList(id) {
  var list = findBulkList(id);
  if (!list) return;
  closeDrawer();
  bulkViewId = id;
  renderBulkListView();
}
function closeBulkView() {
  bulkViewId = null;
  loadSelected();
}

function buildBulkRow(list, p) {
  var row = el('div', 'bulk-row');
  if (p.img) {
    var img = document.createElement('img');
    img.className = 'bulk-row-img';
    img.src = p.img;
    img.alt = '';
    img.addEventListener('error', function () { img.style.display = 'none'; });
    row.appendChild(img);
  }
  var text = el('div', 'set-text');
  text.appendChild(el('div', 'set-name', (p.name || 'Part ' + p.part)));
  text.appendChild(el('div', 'set-num', p.part + ' · ' + p.colour));
  row.appendChild(text);
  var minus = el('button', 'build-step-btn', '−');
  minus.type = 'button';
  minus.setAttribute('aria-label', 'One fewer ' + p.part + ' ' + p.colour);
  minus.addEventListener('click', function () { setScannedQty(list.id, p.part, p.colour, p.qty - 1); });
  row.appendChild(minus);
  row.appendChild(el('span', 'bulk-row-qty', String(p.qty)));
  var plus = el('button', 'build-step-btn', '+');
  plus.type = 'button';
  plus.setAttribute('aria-label', 'One more ' + p.part + ' ' + p.colour);
  plus.addEventListener('click', function () { setScannedQty(list.id, p.part, p.colour, p.qty + 1); });
  row.appendChild(plus);
  var del = el('button', 'set-del-btn', '×');
  del.type = 'button';
  del.setAttribute('aria-label', 'Remove ' + p.part + ' ' + p.colour);
  del.addEventListener('click', function () { setScannedQty(list.id, p.part, p.colour, 0); });
  row.appendChild(del);
  return row;
}

function renderBulkListView() {
  var list = findBulkList(bulkViewId);
  var view = $('setView');
  if (viewObserver) { viewObserver.disconnect(); viewObserver = null; }
  view.innerHTML = '';
  viewPending = [];
  viewTierGrids = {};
  viewSentinel = null;
  viewMoreBtn = null;
  if (!list) { bulkViewId = null; showEmpty(); return; }
  $('emptyState').hidden = true;
  $('progressWrap').hidden = true;
  var h = el('h2', null, list.name);
  h.style.margin = '4px 0 4px';
  view.appendChild(h);
  view.appendChild(el('p', 'muted', bulkListPieces(list) + ' pieces · ' + list.parts.length + ' lots · saved on this phone only'));
  var row = el('div', 'bulk-actions');
  var addBtn = el('button', 'btn btn-small', '📷 Add more');
  addBtn.type = 'button';
  addBtn.addEventListener('click', function () { startScan(list.id); });
  row.appendChild(addBtn);
  var optBtn = el('button', 'btn btn-small', 'Find optimal sets');
  optBtn.type = 'button';
  optBtn.addEventListener('click', function () { runOptimizer(list.id, 'pieces'); });
  row.appendChild(optBtn);
  var delBtn = el('button', 'btn btn-small btn-quiet', 'Delete list');
  delBtn.type = 'button';
  delBtn.addEventListener('click', function () {
    showConfirm({
      title: 'Delete this bulk list?',
      message: 'This removes "' + list.name + '" and its ' + bulkListPieces(list) + ' scanned pieces from this phone.',
      confirmLabel: 'Delete',
      onConfirm: function () { deleteBulkList(list.id); }
    });
  });
  row.appendChild(delBtn);
  var backBtn = el('button', 'btn btn-small btn-quiet', '← Back to sets');
  backBtn.type = 'button';
  backBtn.addEventListener('click', function () { closeBulkView(); });
  row.appendChild(backBtn);
  view.appendChild(row);
  var partsWrap = el('div', 'bulk-parts');
  if (!list.parts.length) {
    partsWrap.appendChild(el('p', 'muted', 'Nothing scanned yet — tap "Add more" and point the camera at a piece.'));
  }
  list.parts.forEach(function (p) { partsWrap.appendChild(buildBulkRow(list, p)); });
  view.appendChild(partsWrap);
  bulkOptWrap = el('div', 'bulk-opt');
  view.appendChild(bulkOptWrap);
  renderBulkLists();
}

/* ---------- Optimizer: what sets come out of a bulk list (v3.36) ----------
 * Four sort modes over the tracked sets: Most pieces (pieces of the
 * bulk list a set uses), Newest (by year), Fewest missing (fewest
 * pieces left to find — closest to complete), and Cheapest to
 * complete (the remaining parts priced through BrickOwl, cheapest
 * first). The "Colour doesn't matter" toggle matches by part number
 * only, ignoring colour, for every mode — the set's real inventory
 * still records colour; only the evaluation ignores it. Below the
 * tracked results, "Sets you don't track yet" suggests sets from the
 * full Rebrickable catalog that share parts with the bulk list, with
 * an Add to My sets action that imports through the existing path. */
var bulkOptSort = 'pieces';
var bulkOptBlind = false;
var bulkOptExcludeMinifig = false;
var bulkOptRun = 0;
var bulkOptPriceBtn = null;
var bulkOptBlindBtn = null;
var bulkOptMinifigBtn = null;
var bulkSuggWrap = null;
var bulkSuggState = { listId: null, status: 'idle', candidates: [], queried: [], partial: false, unmapped: [], error: '', remaining: [], cacheKey: null };

// A minifigure lot, for the optimizer's Exclude minifigures toggle
// (v3.36): any lot in a Minifig* category — heads, torsos, legs,
// accessories, whole figures — or a lot that exports as a BrickLink
// minifig (type M, the rock monsters), whatever its stored category
// says. When the toggle is on, these lots count on neither side of
// the match: they never cover a bulk piece and never add to missing.
function isMinifigLot(lot) {
  if (!lot) return false;
  if (String(lot.cat || '').indexOf('Minifig') === 0) return true;
  var blp = brickLinkPartFor(lot, 1);
  return !!(blp && blp.type === 'M');
}

function rankBulkListSets(list, sortMode, blind, excludeMinifig) {
  function freshPool() {
    var pool = {};
    (list.parts || []).forEach(function (p) {
      var b = pool[p.part] || (pool[p.part] = { total: 0, byColour: {} });
      b.total += p.qty;
      b.byColour[p.colour] = (b.byColour[p.colour] || 0) + p.qty;
    });
    return pool;
  }
  // Take qty pieces of part pn from the pool: a specific-colour lot
  // takes only its colour; an "any colour" lot takes whatever is
  // there, spending the fullest colour buckets first so later
  // specific lots see what is really left. Colour-doesn't-matter
  // mode takes any colour for every lot.
  function takeFrom(pool, pn, colour, qty) {
    var b = pool[pn];
    if (!b || b.total <= 0) return 0;
    var n = 0;
    if (colour) {
      n = Math.min(b.byColour[colour] || 0, qty);
      if (n > 0) b.byColour[colour] -= n;
    } else {
      n = Math.min(b.total, qty);
      var left = n;
      var cols = Object.keys(b.byColour).sort(function (a, c) { return b.byColour[c] - b.byColour[a]; });
      cols.forEach(function (c) {
        if (left <= 0) return;
        var d = Math.min(b.byColour[c], left);
        b.byColour[c] -= d;
        left -= d;
      });
    }
    b.total -= n;
    return n;
  }
  var results = [];
  sets.forEach(function (s) {
    var inv = getInventory(s.set_num);
    if (!inv) return;
    var pool = freshPool();
    var pieces = 0, lots = 0;
    var totalPieces = 0, totalLots = 0;
    inv.items.forEach(function (lot) {
      // Exclude minifigures: the lot counts on neither side — it
      // never covers a bulk piece, and it adds nothing to the total
      // the set is measured against.
      if (excludeMinifig && isMinifigLot(lot)) return;
      totalPieces += lot.qty;
      totalLots++;
      var n = (blind || lot.any)
        ? takeFrom(pool, partNumOf(lot), null, lot.qty)
        : takeFrom(pool, partNumOf(lot), lot.colour, lot.qty);
      if (n > 0) { pieces += n; lots++; }
    });
    var prog = setFoundTotal(s.key, excludeMinifig);
    results.push({
      setKey: s.key, setName: s.set_name || s.set_num,
      year: (typeof s.year === 'number') ? s.year : null,
      piecesCovered: pieces, lotsCovered: lots,
      totalPieces: excludeMinifig ? totalPieces : inv.pieces,
      totalLots: excludeMinifig ? totalLots : inv.lots,
      foundPieces: prog.found, remainingPieces: Math.max(0, prog.total - prog.found),
      costUsd: null, unpricedLots: 0
    });
  });
  if (sortMode === 'newest') {
    results.sort(function (a, b) {
      var ya = (a.year === null ? -1 : a.year), yb = (b.year === null ? -1 : b.year);
      if (yb !== ya) return yb - ya;
      if (b.piecesCovered !== a.piecesCovered) return b.piecesCovered - a.piecesCovered;
      return a.setName < b.setName ? -1 : 1;
    });
  } else if (sortMode === 'fewest') {
    results.sort(function (a, b) {
      if (a.remainingPieces !== b.remainingPieces) return a.remainingPieces - b.remainingPieces;
      if (b.piecesCovered !== a.piecesCovered) return b.piecesCovered - a.piecesCovered;
      return a.setName < b.setName ? -1 : 1;
    });
  } else if (sortMode === 'price') {
    results.sort(priceSort);
  } else {
    results.sort(function (a, b) {
      if (b.piecesCovered !== a.piecesCovered) return b.piecesCovered - a.piecesCovered;
      if (b.lotsCovered !== a.lotsCovered) return b.lotsCovered - a.lotsCovered;
      return a.setName < b.setName ? -1 : 1;
    });
  }
  return results;
}
// Cheapest to complete first; a set with no price at all sorts last,
// then fewest pieces left, then name.
function priceSort(a, b) {
  var ca = (a.costUsd === null || a.costUsd === undefined) ? Infinity : a.costUsd;
  var cb = (b.costUsd === null || b.costUsd === undefined) ? Infinity : b.costUsd;
  if (ca !== cb) return ca - cb;
  if (a.remainingPieces !== b.remainingPieces) return a.remainingPieces - b.remainingPieces;
  return a.setName < b.setName ? -1 : 1;
}

var OPT_HEADING = { pieces: 'Sets this bulk can build', newest: 'Sets this bulk can build', fewest: 'Closest to complete', price: 'Cheapest to complete' };

function buildOptSortRow(listId) {
  var sortRow = el('div', 'bulk-actions');
  function sortBtn(mode, label) {
    var b = el('button', 'btn btn-small' + (bulkOptSort === mode ? '' : ' btn-quiet'), label);
    b.type = 'button';
    b.addEventListener('click', function () { runOptimizer(listId, mode); });
    sortRow.appendChild(b);
    return b;
  }
  sortBtn('pieces', 'Most pieces');
  sortBtn('newest', 'Newest');
  sortBtn('fewest', 'Fewest missing');
  bulkOptPriceBtn = sortBtn('price', 'Cheapest to complete');
  bulkOptPriceBtn.title = 'Rank by the cost of the parts still needed, priced through BrickOwl.';
  bulkOptBlindBtn = el('button', 'btn btn-small bulk-opt-toggle' + (bulkOptBlind ? ' on' : ''), 'Colour doesn\'t matter');
  bulkOptBlindBtn.type = 'button';
  bulkOptBlindBtn.setAttribute('aria-pressed', bulkOptBlind ? 'true' : 'false');
  bulkOptBlindBtn.title = 'Match parts by number only, ignoring colour. The sets themselves still track colour.';
  bulkOptBlindBtn.addEventListener('click', function () {
    bulkOptBlind = !bulkOptBlind;
    // Suggestions were fetched for the other matching rule.
    bulkSuggState = { listId: null, status: 'idle', candidates: [], queried: [], partial: false, unmapped: [], error: '', remaining: [], cacheKey: null };
    runOptimizer(listId, bulkOptSort);
  });
  sortRow.appendChild(bulkOptBlindBtn);
  bulkOptMinifigBtn = el('button', 'btn btn-small bulk-opt-toggle' + (bulkOptExcludeMinifig ? ' on' : ''), 'Exclude minifigures');
  bulkOptMinifigBtn.type = 'button';
  bulkOptMinifigBtn.setAttribute('aria-pressed', bulkOptExcludeMinifig ? 'true' : 'false');
  bulkOptMinifigBtn.title = 'Ignore minifigure lots when matching — a set is not penalised for minifigures the bulk pile lacks.';
  bulkOptMinifigBtn.addEventListener('click', function () {
    bulkOptExcludeMinifig = !bulkOptExcludeMinifig;
    // Suggestions were fetched for the other matching rule.
    bulkSuggState = { listId: null, status: 'idle', candidates: [], queried: [], partial: false, unmapped: [], error: '', remaining: [], cacheKey: null };
    runOptimizer(listId, bulkOptSort);
  });
  sortRow.appendChild(bulkOptMinifigBtn);
  return sortRow;
}

function buildOptFooter(list) {
  var p = el('p', 'muted small');
  var blindNote = bulkOptBlind ? ' Colour doesn\'t matter is on — parts match by number only.' : '';
  var minifigNote = bulkOptExcludeMinifig ? ' Minifigures excluded from the match.' : '';
  if (bulkOptSort === 'price') {
    // innerHTML, not createTextNode: the harness stub document has
    // no createTextNode, and the link is a static string either way.
    p.innerHTML = 'Prices via <a href="https://www.brickowl.com" target="_blank">BrickOwl</a> — US stores, new condition, cheapest lot found per part. Lots BrickOwl can\'t price are left out and counted.' + (bulkOptBlind ? ' Colour doesn\'t matter is on — each part is priced in its cheapest colour.' : '') + minifigNote;
  } else if (bulkOptSort === 'fewest') {
    p.textContent = 'Ranked by fewest pieces left to find. Candidates are the sets in My sets.' + blindNote + minifigNote;
  } else {
    p.textContent = 'Candidates are the sets in My sets. Sets added before v3.33 have no year, so they sort last under Newest.' + blindNote + minifigNote;
  }
  return p;
}

function optRowText(r) {
  if (bulkOptSort === 'fewest') {
    return r.remainingPieces + ' pieces left · ' + r.foundPieces + ' of ' + r.totalPieces + ' found';
  }
  if (bulkOptSort === 'price') {
    var t = (r.costUsd === null || r.costUsd === undefined)
      ? 'Cost to complete — no prices yet'
      : 'Cost to complete ' + fmtUsd(r.costUsd) + ' · ' + r.remainingPieces + ' pieces left';
    if (r.unpricedLots > 0) t += ' · ' + r.unpricedLots + ' lot' + (r.unpricedLots === 1 ? '' : 's') + ' unpriced';
    return t;
  }
  var pct = r.totalPieces ? Math.round(100 * r.piecesCovered / r.totalPieces) : 0;
  return r.piecesCovered + ' of ' + r.totalPieces + ' pieces (' + pct + '%) · ' + r.lotsCovered + ' lots';
}

function renderOptRows(wrap, results, list) {
  var show = (bulkOptSort === 'fewest' || bulkOptSort === 'price')
    ? results
    : results.filter(function (r) { return r.piecesCovered > 0; });
  if (!list.parts.length) {
    wrap.appendChild(el('p', 'muted', 'Scan some pieces first — the optimizer ranks your tracked sets against this list.'));
  } else if (!show.length) {
    wrap.appendChild(el('p', 'muted', (bulkOptSort === 'fewest' || bulkOptSort === 'price')
      ? 'No tracked sets yet — add a set to rank it here.'
      : 'No tracked set uses any piece from this list yet.'));
  } else {
    show.forEach(function (r) {
      var row = el('div', 'bulk-opt-row');
      var text = el('div', 'set-text');
      text.appendChild(el('div', 'set-name', r.setName + (r.year ? ' (' + r.year + ')' : '')));
      text.appendChild(el('div', 'set-num', optRowText(r)));
      row.appendChild(text);
      row.addEventListener('click', function () { openSet(r.setKey); });
      wrap.appendChild(row);
    });
  }
}

function runOptimizer(listId, sortMode) {
  var list = findBulkList(listId);
  if (!list || !bulkOptWrap) return;
  if (sortMode) bulkOptSort = sortMode;
  bulkOptRun++;
  var runId = bulkOptRun;
  var wrap = bulkOptWrap;
  wrap.innerHTML = '';
  wrap.appendChild(el('h3', null, OPT_HEADING[bulkOptSort] || OPT_HEADING.pieces));
  wrap.appendChild(buildOptSortRow(listId));
  var resultsEl = el('div', 'bulk-opt-results');
  wrap.appendChild(resultsEl);
  var suggEl = el('div', 'bulk-opt-sugg');
  wrap.appendChild(suggEl);
  bulkSuggWrap = suggEl;
  wrap.appendChild(buildOptFooter(list));
  if (bulkOptSort === 'price') {
    resultsEl.appendChild(el('p', 'muted', 'Getting prices from BrickOwl…'));
    renderPriceResults(list, resultsEl, runId);
  } else {
    renderOptRows(resultsEl, rankBulkListSets(list, bulkOptSort, bulkOptBlind, bulkOptExcludeMinifig), list);
  }
  renderSuggestionsInto(suggEl, list);
}

// Price mode: fetch every tracked set's cost to complete, then rank.
// A mode switch while fetching abandons the stale render (runId).
async function renderPriceResults(list, resultsEl, runId) {
  var results = rankBulkListSets(list, 'price', bulkOptBlind, bulkOptExcludeMinifig);
  var firstErr = null;
  for (var i = 0; i < results.length; i++) {
    var f = await fetchSetPrices(results[i].setKey, bulkOptBlind, bulkOptExcludeMinifig);
    if (f.error && !firstErr) firstErr = f.error;
    results[i].costUsd = (typeof f.totalUsd === 'number') ? f.totalUsd : null;
    results[i].unpricedLots = f.unpricedLots || 0;
  }
  if (runId !== bulkOptRun) return;
  results.sort(priceSort);
  resultsEl.innerHTML = '';
  if (firstErr) {
    resultsEl.appendChild(el('p', 'muted', priceErrorText(firstErr)));
  }
  renderOptRows(resultsEl, results, list);
}

/* ---------- Price mode: BrickOwl through get-prices (v3.36) ----------
 * The app never calls BrickOwl directly — the key lives in the
 * get-prices Edge Function. Prices are cached on this device for 7
 * days (keyed by part+colour, or by part alone when Colour doesn't
 * matter is on), so a repeat ranking costs no BrickOwl calls. Only
 * part lots are priced: sticker sheets and minifig lots (the rock
 * monsters) have no BrickOwl part price, so they are counted as
 * unpriced and left out of the total, never guessed. */
var PRICE_TTL_MS = 7 * 24 * 3600 * 1000;
function loadPriceCache() {
  var v = LS.get('bf:prices', {});
  return (v && typeof v === 'object') ? v : {};
}
function savePriceCache(c) { LS.set('bf:prices', c); }
function priceCacheKey(design, blColour, blind) {
  return blind ? String(design) + '|any' : String(design) + '|' + String(blColour);
}
function fmtUsd(n) { return '$' + Number(n).toFixed(2); }
// Pieces still to find for one lot of one set, read straight from
// the saved counts (works for sets that aren't selected, whose
// counts map isn't in memory).
function remOfLot(setKey, lot) {
  var counts = LS.get(countsKey(setKey), null);
  if (!counts || typeof counts[lot.id] !== 'number') return lot.qty;
  return Math.max(0, Math.min(lot.qty, counts[lot.id]));
}
function remainingPriceLines(setKey, blind, excludeMinifig) {
  var inv = getInventory(setKey);
  var lines = [], unpriced = 0;
  if (!inv) return { lines: lines, unpriced: unpriced };
  var byKey = {};
  inv.items.forEach(function (lot) {
    var rem = remOfLot(setKey, lot);
    if (rem <= 0) return;
    // Exclude minifigures: the lot is left out of the price and out
    // of the unpriced count — ignored entirely, on neither side.
    if (excludeMinifig && isMinifigLot(lot)) return;
    if (lot.cat === 'Stickers') { unpriced++; return; }
    var blp = brickLinkPartFor(lot, rem);
    if (blp.skip || blp.type !== 'P') { unpriced++; return; }
    var bl = brickLinkColourId(lot);
    if (bl === undefined) { unpriced++; return; }
    var key = priceCacheKey(partNumOf(lot), bl, blind);
    var ln = byKey[key];
    if (!ln) {
      ln = { key: key, design_id: partNumOf(lot), bl_colour: bl, qty: 0, lots: 0, blind: blind };
      byKey[key] = ln;
      lines.push(ln);
    }
    ln.qty += rem;
    ln.lots++;
  });
  return { lines: lines, unpriced: unpriced };
}
var GETPRICES_NO_RETRY = { no_api_key: 1, bad_request: 1, unauthorized: 1 };
async function invokeGetPrices(body) {
  var lastRes = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    var res;
    try {
      res = await sb.functions.invoke('get-prices', { body: body });
    } catch (e) {
      if (attempt === 0) continue;
      throw e;
    }
    lastRes = res;
    var payload = (res && res.data) || null;
    if (payload && payload.ok) return res;
    var code = (payload && payload.error) || null;
    if (!code) {
      var ctx = (res && res.error && res.error.context) || null;
      code = (ctx && ctx.error) || null;
    }
    if (code && GETPRICES_NO_RETRY[code]) return res;
    if (attempt === 0) continue;
    return res;
  }
  return lastRes;
}
function priceErrorText(code) {
  if (code === 'no_api_key') return 'Price mode isn\'t set up yet — add the BrickOwl key (BRICKOWL_API_KEY) in the Supabase dashboard (Edge Functions > Secrets), then deploy the get-prices function.';
  if (code === 'unauthorized') return 'Log in first — pricing needs an account.';
  if (code === 'bad_request') return 'Something odd was sent for pricing — try again.';
  if (code === 'network') return 'Couldn\'t reach the price service — check your connection and try again.';
  if (code === 'not_deployed') return 'The get-prices function isn\'t deployed yet — deploy it from the Supabase dashboard (Edge Functions > Deploy get-prices).';
  return 'Pricing isn\'t available right now — try again.';
}
async function fetchSetPrices(setKey, blind, excludeMinifig) {
  if (!sb || !user) return { error: 'unauthorized', totalUsd: null, unpricedLots: 0 };
  var r = remainingPriceLines(setKey, blind, excludeMinifig);
  var cache = loadPriceCache();
  var now = Date.now();
  var total = 0, unpriced = r.unpriced, missing = [];
  var seen = {};
  r.lines.forEach(function (ln) {
    var c = cache[ln.key];
    if (c && typeof c.usd === 'number' && (now - c.at) < PRICE_TTL_MS) {
      total += ln.qty * c.usd;
    } else if (!seen[ln.key]) {
      seen[ln.key] = 1;
      missing.push(ln);
    }
  });
  if (missing.length) {
    var res;
    try {
      res = await invokeGetPrices({ items: missing, country: 'US' });
    } catch (e) {
      return { error: 'network', totalUsd: null, unpricedLots: unpriced };
    }
    var payload = (res && res.data) || null;
    if (!payload || !payload.ok) {
      var code = (payload && payload.error) || null;
      if (!code && res && res.error) code = 'not_deployed';
      return { error: code || 'unknown', totalUsd: null, unpricedLots: unpriced };
    }
    var fresh = {};
    (payload.prices || []).forEach(function (p) {
      fresh[p.key] = p.usd;
      cache[p.key] = { usd: p.usd, at: now };
    });
    savePriceCache(cache);
    missing.forEach(function (ln) {
      if (typeof fresh[ln.key] === 'number') total += ln.qty * fresh[ln.key];
      else unpriced += ln.lots;
    });
  }
  return { totalUsd: total, unpricedLots: unpriced };
}

/* ---------- All-sets suggestions: the full catalog (v3.36) ----------
 * The tracked optimizer only ranks sets already downloaded. This
 * section asks Rebrickable, through the suggest-sets Edge Function,
 * which sets in the whole catalog share parts with the bulk list.
 * The function returns candidates with lotsCovered (distinct bulk
 * lots the set contains) and num_parts; "missing" is the upper
 * bound num_parts - lotsCovered, because Rebrickable's parts-in-sets
 * answers carry no per-set quantity for the part. Exact piece counts
 * appear once the set is imported — one tap on Add to My sets, which
 * runs the existing import path. Tracked sets never appear here:
 * they stay in the section above. Results are cached on this device
 * for 30 days under a key built from the bulk list's parts, so a
 * repeat ranking costs no Rebrickable calls. */
var SUGGEST_TTL_MS = 30 * 24 * 3600 * 1000;
var SUGGEST_MAX_PARTS = 12;
var SUGGEST_SHOW = 10;
function suggestCacheKeyFor(parts, blind, excludeMinifig) {
  var keys = (parts || []).map(function (p) { return p.part + '|' + p.colour + '|' + p.qty; }).sort();
  return keys.join(';') + (blind ? '|blind' : '|exact') + (excludeMinifig ? '|nominifig' : '|minifig');
}
function loadSuggestCache() {
  var v = LS.get('bf:suggest', {});
  return (v && typeof v === 'object') ? v : {};
}
function saveSuggestCache(c) { LS.set('bf:suggest', c); }
function saveSuggestState() {
  var key = bulkSuggState.cacheKey;
  if (!key) return;
  var c = loadSuggestCache();
  c[key] = { at: Date.now(), candidates: bulkSuggState.candidates, remaining: bulkSuggState.remaining };
  saveSuggestCache(c);
}
// Distinct bulk lots, biggest first (the function checks twelve per
// call, so the bulkiest parts go first). bl_colour is the BrickLink
// id when the display colour has one, else null — the function
// resolves the rest by name. With Exclude minifigures on, bulk parts
// that are minifigure lots in a tracked set are left out of the
// query, so minifigures never drive a suggestion match. The
// candidate sets themselves can't be filtered the same way —
// Rebrickable's parts-in-sets answers carry no per-set minifig
// breakdown — so a candidate's missing count still includes its
// minifigures until the set is imported; the results note says so.
function isMinifigBulkPart(part, colour, blind) {
  for (var i = 0; i < sets.length; i++) {
    var inv = getInventory(sets[i].set_num);
    if (!inv) continue;
    for (var j = 0; j < inv.items.length; j++) {
      var lot = inv.items[j];
      if (partNumOf(lot) !== part) continue;
      if (!blind && (lot.colour || '') !== colour) continue;
      if (isMinifigLot(lot)) return true;
    }
  }
  return false;
}
function distinctBulkParts(list, excludeMinifig, blind) {
  var byKey = {}, order = [];
  (list.parts || []).forEach(function (p) {
    if (excludeMinifig && isMinifigBulkPart(p.part, p.colour, blind)) return;
    var k = p.part + '|' + p.colour;
    if (!byKey[k]) { byKey[k] = { part: p.part, colour: p.colour, qty: 0, bl_colour: null }; order.push(byKey[k]); }
    byKey[k].qty += p.qty;
  });
  order.forEach(function (it) {
    var bl = BRICKLINK_COLOUR[it.colour];
    it.bl_colour = (bl === undefined) ? null : bl;
  });
  order.sort(function (a, b) { return b.qty - a.qty; });
  return order;
}
// Same ranking rules as the Edge Function's suggest.ts, so cached
// candidates re-sort locally when the sort mode changes.
function rankSuggestionsLocal(cands, mode) {
  var list = (cands || []).slice();
  function missing(c) { return (typeof c.missingUpper === 'number') ? c.missingUpper : Math.max(0, c.num_parts - c.lotsCovered); }
  if (mode === 'newest') {
    list.sort(function (a, b) {
      var ya = (a.year === null || a.year === undefined) ? -1 : a.year;
      var yb = (b.year === null || b.year === undefined) ? -1 : b.year;
      if (yb !== ya) return yb - ya;
      if (b.lotsCovered !== a.lotsCovered) return b.lotsCovered - a.lotsCovered;
      return a.name < b.name ? -1 : 1;
    });
  } else if (mode === 'fewest' || mode === 'price') {
    list.sort(function (a, b) {
      if (missing(a) !== missing(b)) return missing(a) - missing(b);
      if (b.lotsCovered !== a.lotsCovered) return b.lotsCovered - a.lotsCovered;
      return a.name < b.name ? -1 : 1;
    });
  } else {
    list.sort(function (a, b) {
      if (b.lotsCovered !== a.lotsCovered) return b.lotsCovered - a.lotsCovered;
      if (a.num_parts !== b.num_parts) return a.num_parts - b.num_parts;
      return a.name < b.name ? -1 : 1;
    });
  }
  return list;
}
// Merge a fresh batch of candidates into the running list. Batches
// cover disjoint parts, so a set found in both batches adds its lot
// counts together; missing is recomputed from the new total.
function mergeCandidates(into, fresh) {
  var byNum = {};
  into.forEach(function (c) { byNum[c.set_num] = c; });
  (fresh || []).forEach(function (c) {
    var ex = byNum[c.set_num];
    if (!ex) {
      var copy = { set_num: c.set_num, name: c.name, year: c.year, num_parts: c.num_parts, set_img_url: c.set_img_url, lotsCovered: c.lotsCovered, missingUpper: c.missingUpper };
      into.push(copy);
      byNum[c.set_num] = copy;
      return;
    }
    ex.lotsCovered += c.lotsCovered;
    ex.missingUpper = Math.max(0, ex.num_parts - ex.lotsCovered);
  });
  return into;
}
var SUGGEST_NO_RETRY = { no_api_key: 1, bad_request: 1, unauthorized: 1, rate_limited: 1 };
async function invokeSuggestSets(body) {
  var lastRes = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    var res;
    try {
      res = await sb.functions.invoke('suggest-sets', { body: body });
    } catch (e) {
      if (attempt === 0) continue;
      throw e;
    }
    lastRes = res;
    var payload = (res && res.data) || null;
    if (payload && payload.ok) return res;
    var code = (payload && payload.error) || null;
    if (!code) {
      var ctx = (res && res.error && res.error.context) || null;
      code = (ctx && ctx.error) || null;
    }
    if (code && SUGGEST_NO_RETRY[code]) return res;
    if (attempt === 0) continue;
    return res;
  }
  return lastRes;
}
function suggestErrorText(code) {
  if (code === 'no_api_key') return 'Suggestions aren\'t set up yet — the Rebrickable key (REBRICKABLE_API_KEY) is missing in the Supabase dashboard (Edge Functions > Secrets).';
  if (code === 'rate_limited') return 'Rebrickable is busy right now (its limit is about 1 call a second) — wait a minute and try again.';
  if (code === 'unauthorized') return 'Log in first — suggestions need an account.';
  if (code === 'bad_request') return 'Something odd was sent for suggestions — try again.';
  if (code === 'network') return 'Couldn\'t reach the suggestions service — check your connection and try again.';
  if (code === 'not_deployed') return 'The suggest-sets function isn\'t deployed yet — deploy it from the Supabase dashboard (Edge Functions > Deploy suggest-sets).';
  return 'Suggestions aren\'t available right now — try again.';
}
async function findSuggestions(listId, more) {
  var list = findBulkList(listId);
  if (!list) return;
  var parts = distinctBulkParts(list, bulkOptExcludeMinifig, bulkOptBlind);
  if (!parts.length) return;
  if (!more) {
    var key = suggestCacheKeyFor(parts, bulkOptBlind, bulkOptExcludeMinifig);
    var cached = loadSuggestCache()[key];
    if (cached && (Date.now() - cached.at) < SUGGEST_TTL_MS) {
      bulkSuggState = { listId: listId, status: 'done', candidates: cached.candidates || [], queried: [], partial: false, unmapped: [], error: '', remaining: cached.remaining || [], cacheKey: key };
      renderSuggestionsInto(bulkSuggWrap, list);
      return;
    }
    bulkSuggState = { listId: listId, status: 'loading', candidates: [], queried: [], partial: false, unmapped: [], error: '', remaining: parts.slice(), cacheKey: key };
    renderSuggestionsInto(bulkSuggWrap, list);
    await fetchSuggestBatch(list, parts.slice(0, SUGGEST_MAX_PARTS));
    return;
  }
  var next = bulkSuggState.remaining.slice(0, SUGGEST_MAX_PARTS);
  if (!next.length) return;
  bulkSuggState.status = 'loading';
  renderSuggestionsInto(bulkSuggWrap, list);
  await fetchSuggestBatch(list, next);
}
async function fetchSuggestBatch(list, batch) {
  var res;
  try {
    res = await invokeSuggestSets({ parts: batch, blind: bulkOptBlind });
  } catch (e) {
    bulkSuggState.status = 'error';
    bulkSuggState.error = 'network';
    renderSuggestionsInto(bulkSuggWrap, list);
    return;
  }
  var payload = (res && res.data) || null;
  if (!payload || !payload.ok) {
    var code = (payload && payload.error) || null;
    bulkSuggState.status = 'error';
    bulkSuggState.error = code || (res && res.error ? 'not_deployed' : 'unknown');
    renderSuggestionsInto(bulkSuggWrap, list);
    return;
  }
  mergeCandidates(bulkSuggState.candidates, payload.candidates || []);
  bulkSuggState.queried = (bulkSuggState.queried || []).concat(payload.queried || []);
  bulkSuggState.partial = !!payload.partial;
  bulkSuggState.unmapped = (bulkSuggState.unmapped || []).concat(payload.unmapped || []);
  bulkSuggState.remaining = (bulkSuggState.remaining || []).slice(batch.length);
  bulkSuggState.status = 'done';
  saveSuggestState();
  renderSuggestionsInto(bulkSuggWrap, list);
}
function renderSuggestionsInto(wrap, list) {
  if (!wrap) return;
  if (!list || bulkSuggState.listId !== list.id) {
    bulkSuggState = { listId: list ? list.id : null, status: 'idle', candidates: [], queried: [], partial: false, unmapped: [], error: '', remaining: [], cacheKey: null };
  }
  wrap.innerHTML = '';
  wrap.appendChild(el('h3', null, 'Sets you don\'t track yet'));
  if (bulkOptExcludeMinifig) {
    wrap.appendChild(el('p', 'muted small', 'Minifigures excluded from the match — minifig pieces in this bulk list didn\'t drive these suggestions. A candidate\'s missing count still includes its minifigures until you import it.'));
  }
  var st = bulkSuggState;
  if (st.status === 'idle') {
    wrap.appendChild(el('p', 'muted', 'Suggestions check the full catalog on Rebrickable — the sets sharing parts with this bulk list. Tracked sets stay in the section above; these are new ones.'));
    var btn = el('button', 'btn btn-small', 'Find sets in the full catalog');
    btn.type = 'button';
    btn.addEventListener('click', function () { findSuggestions(list.id, false); });
    wrap.appendChild(btn);
    return;
  }
  if (st.status === 'loading') {
    wrap.appendChild(el('p', 'muted', 'Checking the full catalog… Rebrickable answers about one part a second, so a big bulk list takes a while.'));
    return;
  }
  if (st.status === 'error') {
    wrap.appendChild(el('p', 'muted', suggestErrorText(st.error)));
    var retry = el('button', 'btn btn-small', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', function () { findSuggestions(list.id, false); });
    wrap.appendChild(retry);
    return;
  }
  var fresh = st.candidates.filter(function (c) { return !findSet(c.set_num); });
  var ranked = rankSuggestionsLocal(fresh, bulkOptSort);
  if (!ranked.length) {
    wrap.appendChild(el('p', 'muted', 'No untracked set shares a part with this bulk list.'));
  } else {
    ranked.slice(0, SUGGEST_SHOW).forEach(function (c) {
      var row = el('div', 'bulk-opt-row sugg-row');
      var text = el('div', 'set-text');
      text.appendChild(el('div', 'set-name', c.name + (c.year ? ' (' + c.year + ')' : '')));
      var missing = (typeof c.missingUpper === 'number') ? c.missingUpper : Math.max(0, c.num_parts - c.lotsCovered);
      var sub = 'Shares ' + c.lotsCovered + ' lot' + (c.lotsCovered === 1 ? '' : 's') + ' · ' + c.num_parts + ' pieces total · up to ' + missing + ' missing';
      if (bulkOptSort === 'price') sub += ' · exact price after import';
      text.appendChild(el('div', 'set-num', sub));
      row.appendChild(text);
      var add = el('button', 'btn btn-small sugg-add', 'Add to My sets');
      add.type = 'button';
      add.addEventListener('click', function (e) { if (e && e.stopPropagation) e.stopPropagation(); addSuggestedSet(c.set_num, add); });
      row.appendChild(add);
      wrap.appendChild(row);
    });
    if (ranked.length > SUGGEST_SHOW) {
      wrap.appendChild(el('p', 'muted small', 'Showing the top ' + SUGGEST_SHOW + ' of ' + ranked.length + ' suggestions.'));
    }
  }
  if (st.partial && st.remaining.length) {
    var more = el('button', 'btn btn-small', 'Check ' + st.remaining.length + ' more part' + (st.remaining.length === 1 ? '' : 's'));
    more.type = 'button';
    more.addEventListener('click', function () { findSuggestions(list.id, true); });
    wrap.appendChild(more);
    wrap.appendChild(el('p', 'muted small', 'Only the first parts have been checked so far — more parts may surface more sets.'));
  } else if (st.partial) {
    wrap.appendChild(el('p', 'muted small', 'Rebrickable was busy, so some parts weren\'t checked — try again in a bit.'));
  }
  if (st.unmapped.length) {
    wrap.appendChild(el('p', 'muted small', 'Not checked (' + st.unmapped.length + '): ' + st.unmapped.map(function (u) { return u.part + ' ' + u.colour; }).join(', ') + '.'));
  }
}
async function addSuggestedSet(setNum, btn) {
  if (findSet(setNum)) { btn.textContent = 'Added ✓'; btn.disabled = true; return; }
  btn.disabled = true;
  btn.textContent = 'Adding…';
  var res;
  try {
    res = await invokeImportSet({ set_num: setNum }, null);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Add to My sets';
    return;
  }
  var payload = (res && res.data) || null;
  if (!payload || !payload.ok) {
    btn.disabled = false;
    btn.textContent = 'Add to My sets';
    return;
  }
  pendingImport = {
    set_num: payload.set.set_num, name: payload.set.name, year: payload.set.year,
    num_parts: payload.set.num_parts, set_img_url: payload.set.set_img_url,
    inventory: payload.inventory, lots: payload.lots, pieces: payload.pieces,
    cached: !!payload.cached
  };
  addImportedSet(false);
  bulkSuggState.candidates = bulkSuggState.candidates.filter(function (c) { return c.set_num !== setNum; });
  saveSuggestState();
  runOptimizer(bulkSuggState.listId, bulkOptSort);
}

/* ---------- Camera scan ---------- */
var scanState = { listId: null, stream: null, identifying: false, lastRequestAt: 0, lastColour: null, pending: null };
var scanOverlay = null, scanVideo = null, scanCanvas = null, scanStatusEl = null,
    scanCaptureBtn = null, scanConfirmEl = null, scanPhotoEl = null,
    scanPartNumEl = null, scanPartNameEl = null, scanScoreEl = null,
    scanColourSel = null, scanMetaEl = null, scanDoneBtn = null, scanCancelBtn = null,
    scanQtyEl = null, scanQtyMinusBtn = null, scanQtyPlusBtn = null,
    scanChipsEl = null,
    scanControlsEl = null, scanFileInput = null, scanViewListBtn = null;
var scanPickerModal = null, scanPickerList = null, scanNewNameInput = null, scanPickerMsg = null, scanCreateBtn = null;

function ensureScanPicker() {
  if (scanPickerModal) return scanPickerModal;
  var overlay = document.createElement('div');
  overlay.className = 'confirm-modal hunt-chooser';
  overlay.hidden = true;
  var box = document.createElement('div');
  box.className = 'confirm-box';
  var title = document.createElement('h3');
  title.textContent = 'Scan into a bulk list';
  box.appendChild(title);
  var sub = document.createElement('p');
  sub.textContent = 'Point the camera at one piece at a time. Brickognize names the part; you pick the colour.';
  box.appendChild(sub);
  scanPickerList = document.createElement('div');
  box.appendChild(scanPickerList);
  var newRow = document.createElement('div');
  newRow.className = 'scan-new-row';
  scanNewNameInput = document.createElement('input');
  scanNewNameInput.type = 'text';
  scanNewNameInput.placeholder = 'New list name, e.g. BAM bin 3';
  scanNewNameInput.setAttribute('aria-label', 'New bulk list name');
  newRow.appendChild(scanNewNameInput);
  var createBtn = document.createElement('button');
  createBtn.type = 'button'; createBtn.className = 'btn btn-small'; createBtn.textContent = 'Create & scan';
  scanCreateBtn = createBtn;
  createBtn.addEventListener('click', function () {
    var name = (scanNewNameInput.value || '').trim();
    if (!name) { scanPickerMsg.textContent = 'Give the list a name first.'; return; }
    var l = createBulkList(name);
    hideScanPicker();
    startScan(l.id);
  });
  newRow.appendChild(createBtn);
  box.appendChild(newRow);
  scanPickerMsg = document.createElement('p');
  scanPickerMsg.className = 'auth-msg';
  box.appendChild(scanPickerMsg);
  var cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'btn btn-quiet'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', hideScanPicker);
  box.appendChild(cancel);
  overlay.appendChild(box);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) hideScanPicker(); });
  document.body.appendChild(overlay);
  scanPickerModal = overlay;
  return overlay;
}
function hideScanPicker() { if (scanPickerModal) scanPickerModal.hidden = true; }
function openScanPicker() {
  var m = ensureScanPicker();
  scanPickerList.innerHTML = '';
  scanPickerMsg.textContent = '';
  if (!bulkLists.length) {
    scanPickerList.appendChild(el('p', 'muted', 'No bulk lists yet — name your first one below.'));
  }
  bulkLists.forEach(function (l) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'hunt-choice';
    btn.textContent = l.name;
    var need = document.createElement('span');
    need.className = 'hunt-need';
    need.textContent = bulkListPieces(l) + ' pieces';
    btn.appendChild(need);
    btn.addEventListener('click', function () { hideScanPicker(); startScan(l.id); });
    scanPickerList.appendChild(btn);
  });
  scanNewNameInput.value = '';
  m.hidden = false;
}

function ensureScanOverlay() {
  if (scanOverlay) return scanOverlay;
  var overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.hidden = true;
  var box = document.createElement('div');
  box.className = 'scan-box';
  scanVideo = document.createElement('video');
  scanVideo.className = 'scan-video';
  scanVideo.setAttribute('playsinline', '');
  scanVideo.setAttribute('muted', '');
  box.appendChild(scanVideo);
  scanControlsEl = document.createElement('div');
  scanControlsEl.className = 'scan-controls';
  scanCaptureBtn = document.createElement('button');
  scanCaptureBtn.type = 'button'; scanCaptureBtn.className = 'btn'; scanCaptureBtn.textContent = '📷 Scan piece';
  scanCaptureBtn.addEventListener('click', captureScan);
  scanControlsEl.appendChild(scanCaptureBtn);
  scanStatusEl = document.createElement('p');
  scanStatusEl.className = 'scan-status';
  scanStatusEl.textContent = 'Point the camera at one piece and tap Scan piece.';
  scanControlsEl.appendChild(scanStatusEl);
  var fileLabel = document.createElement('label');
  fileLabel.className = 'scan-file-label';
  fileLabel.textContent = 'Or pick a photo: ';
  scanFileInput = document.createElement('input');
  scanFileInput.type = 'file';
  scanFileInput.setAttribute('accept', 'image/*');
  scanFileInput.addEventListener('change', function () {
    if (scanFileInput.files && scanFileInput.files[0]) onScanFile(scanFileInput.files[0]);
    scanFileInput.value = '';
  });
  fileLabel.appendChild(scanFileInput);
  scanControlsEl.appendChild(fileLabel);
  scanViewListBtn = document.createElement('button');
  scanViewListBtn.type = 'button'; scanViewListBtn.className = 'btn btn-quiet'; scanViewListBtn.textContent = 'View list';
  scanViewListBtn.addEventListener('click', function () { closeScan(); openBulkList(scanState.listId); });
  scanControlsEl.appendChild(scanViewListBtn);
  var closeBtn = document.createElement('button');
  closeBtn.type = 'button'; closeBtn.className = 'btn btn-quiet'; closeBtn.textContent = '✕ Close';
  closeBtn.addEventListener('click', closeScan);
  scanControlsEl.appendChild(closeBtn);
  box.appendChild(scanControlsEl);
  scanConfirmEl = document.createElement('div');
  scanConfirmEl.className = 'scan-confirm';
  scanConfirmEl.hidden = true;
  scanPhotoEl = document.createElement('img');
  scanPhotoEl.className = 'scan-photo';
  scanPhotoEl.alt = '';
  scanConfirmEl.appendChild(scanPhotoEl);
  scanPartNumEl = document.createElement('div');
  scanPartNumEl.className = 'scan-partnum';
  scanConfirmEl.appendChild(scanPartNumEl);
  scanPartNameEl = document.createElement('div');
  scanPartNameEl.className = 'scan-partname';
  scanConfirmEl.appendChild(scanPartNameEl);
  scanScoreEl = document.createElement('div');
  scanScoreEl.className = 'scan-score muted small';
  scanConfirmEl.appendChild(scanScoreEl);
  // Sampled-colour chips (v3.36): one-tap corrections above the
  // picker. Empty and hidden until a scan samples a colour.
  scanChipsEl = document.createElement('div');
  scanChipsEl.className = 'scan-chips';
  scanChipsEl.hidden = true;
  scanConfirmEl.appendChild(scanChipsEl);
  var colourLabel = document.createElement('label');
  colourLabel.className = 'scan-colour-label';
  colourLabel.textContent = 'Colour ';
  scanColourSel = document.createElement('select');
  scanColourSel.className = 'scan-colour';
  scanColourSel.addEventListener('change', function (e) { onScanColourChange(e.target.value); });
  colourLabel.appendChild(scanColourSel);
  scanConfirmEl.appendChild(colourLabel);
  // Quantity stepper (v3.36): how many of this piece were scanned.
  // Default 1, floor 1. It moves the bulk-list count live, so Done
  // and Cancel both see the right number of copies.
  var qtyRow = document.createElement('div');
  qtyRow.className = 'scan-qty-row';
  qtyRow.appendChild(el('span', 'scan-qty-label', 'Quantity '));
  scanQtyMinusBtn = el('button', 'build-step-btn', '−');
  scanQtyMinusBtn.type = 'button';
  scanQtyMinusBtn.setAttribute('aria-label', 'One fewer of this piece');
  scanQtyMinusBtn.addEventListener('click', function () { setScanQty((scanState.pending ? scanState.pending.qty : 1) - 1); });
  qtyRow.appendChild(scanQtyMinusBtn);
  scanQtyEl = el('span', 'scan-qty', '1');
  qtyRow.appendChild(scanQtyEl);
  scanQtyPlusBtn = el('button', 'build-step-btn', '+');
  scanQtyPlusBtn.type = 'button';
  scanQtyPlusBtn.setAttribute('aria-label', 'One more of this piece');
  scanQtyPlusBtn.addEventListener('click', function () { setScanQty((scanState.pending ? scanState.pending.qty : 1) + 1); });
  qtyRow.appendChild(scanQtyPlusBtn);
  scanConfirmEl.appendChild(qtyRow);
  scanMetaEl = document.createElement('p');
  scanMetaEl.className = 'scan-meta muted small';
  scanConfirmEl.appendChild(scanMetaEl);
  var btnRow = document.createElement('div');
  btnRow.className = 'confirm-buttons';
  scanDoneBtn = document.createElement('button');
  scanDoneBtn.type = 'button'; scanDoneBtn.className = 'btn'; scanDoneBtn.textContent = '✓ Done';
  scanDoneBtn.addEventListener('click', confirmScanDone);
  btnRow.appendChild(scanDoneBtn);
  scanCancelBtn = document.createElement('button');
  scanCancelBtn.type = 'button'; scanCancelBtn.className = 'btn btn-quiet'; scanCancelBtn.textContent = 'Cancel';
  scanCancelBtn.addEventListener('click', cancelScanPending);
  btnRow.appendChild(scanCancelBtn);
  scanConfirmEl.appendChild(btnRow);
  box.appendChild(scanConfirmEl);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  scanOverlay = overlay;
  return overlay;
}

async function startScan(listId) {
  var list = findBulkList(listId);
  if (!list) return;
  scanState.listId = listId;
  scanState.pending = null;
  var overlay = ensureScanOverlay();
  scanConfirmEl.hidden = true;
  scanControlsEl.hidden = false;
  scanVideo.hidden = false;
  overlay.hidden = false;
  scanStatusEl.textContent = 'Point the camera at one piece and tap Scan piece.';
  var md = (typeof navigator !== 'undefined') ? navigator.mediaDevices : null;
  if (!md || !md.getUserMedia) {
    scanStatusEl.textContent = 'This browser can\'t open the camera — pick a photo below instead.';
    return;
  }
  try {
    var stream = await md.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (scanState.stream && scanState.stream !== stream) stopScanStream();
    scanState.stream = stream;
    scanVideo.srcObject = stream;
    if (scanVideo.play) {
      try {
        var pr = scanVideo.play();
        if (pr && pr.catch) pr.catch(function () {});
      } catch (e) {}
    }
  } catch (e) {
    scanStatusEl.textContent = 'Camera blocked — allow camera access for this site, or pick a photo below instead.';
  }
}
function stopScanStream() {
  if (scanState.stream && scanState.stream.getTracks) {
    scanState.stream.getTracks().forEach(function (t) { if (t.stop) t.stop(); });
  }
  scanState.stream = null;
}
function closeScan() {
  stopScanStream();
  scanState.pending = null;
  if (scanOverlay) scanOverlay.hidden = true;
}

function captureScan() {
  if (scanState.identifying) return;
  if (!scanVideo || !scanVideo.videoWidth) {
    scanStatusEl.textContent = 'Camera isn\'t ready yet — wait a second and try again, or pick a photo below.';
    return;
  }
  if (!scanCanvas) scanCanvas = document.createElement('canvas');
  var ctx = scanCanvas.getContext ? scanCanvas.getContext('2d') : null;
  if (!ctx || !scanCanvas.toBlob) {
    scanStatusEl.textContent = 'Capture isn\'t available in this browser — pick a photo below instead.';
    return;
  }
  scanCanvas.width = scanVideo.videoWidth;
  scanCanvas.height = scanVideo.videoHeight;
  ctx.drawImage(scanVideo, 0, 0, scanCanvas.width, scanCanvas.height);
  var photo = '';
  try { photo = scanCanvas.toDataURL('image/jpeg', 0.85); } catch (e) { photo = ''; }
  scanCanvas.toBlob(function (blob) {
    if (blob) identifyPart(blob, photo);
    else scanStatusEl.textContent = 'Couldn\'t grab a frame — try again.';
  }, 'image/jpeg', 0.85);
}

function onScanFile(file) {
  if (typeof FileReader === 'undefined') {
    scanStatusEl.textContent = 'Photo upload isn\'t available in this browser.';
    return;
  }
  var reader = new FileReader();
  reader.onload = function () {
    var dataUrl = String(reader.result || '');
    // Draw the picked photo onto the sampling canvas first, so the
    // Brickognize bounding box (in the photo's own pixels) maps
    // onto the canvas 1:1, exactly like the camera frame does.
    drawPhotoToSampleCanvas(dataUrl, function () { identifyPart(file, dataUrl); });
  };
  reader.onerror = function () { scanStatusEl.textContent = 'Couldn\'t read that photo — try another.'; };
  reader.readAsDataURL(file);
}

// Draw a data-URL photo onto the sampling canvas at its natural
// size. Calls done() once drawn — or at once when the image can't
// be drawn in this browser, so identification still runs, just
// without colour sampling.
function drawPhotoToSampleCanvas(dataUrl, done) {
  if (typeof Image === 'undefined') { done(); return; }
  var img = new Image();
  img.onload = function () {
    try {
      if (!scanCanvas) scanCanvas = document.createElement('canvas');
      var ctx = scanCanvas.getContext ? scanCanvas.getContext('2d') : null;
      if (ctx && img.naturalWidth) {
        scanCanvas.width = img.naturalWidth;
        scanCanvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
      }
    } catch (e) {}
    done();
  };
  img.onerror = function () { done(); };
  img.src = dataUrl;
}

// Brickognize's answer: { items: [{ id, name, score }], bounding_box }
// — the best match first, empty items when nothing was recognised.
// No colour in the response, which is why the confirm card asks for
// one — but the top-level bounding_box (pixel coordinates in the
// submitted image, verified live 2026-11-26: { left, upper, right,
// lower, image_width, image_height }) tells the sampler where the
// piece is, so the colour can be read off the photo.
function parseBrickognizeResponse(json) {
  if (!json || !json.items || !json.items.length) return null;
  var it = json.items[0];
  if (!it || it.id === undefined || it.id === null || String(it.id) === '') return null;
  var bb = (json && json.bounding_box) || null;
  var box = null;
  if (bb && isFinite(bb.left) && isFinite(bb.upper) && isFinite(bb.right) && isFinite(bb.lower) && bb.image_width > 0 && bb.image_height > 0) {
    box = { left: bb.left, upper: bb.upper, right: bb.right, lower: bb.lower, image_width: bb.image_width, image_height: bb.image_height };
  }
  return { part: String(it.id), name: String(it.name || ''), score: (typeof it.score === 'number') ? it.score : null, box: box };
}

// Nearest LEGO colours to a sampled RGB, closest first, among the
// colours the picker can offer. Options with no RGB entry are never
// picked. Ties break alphabetically, so the solid twin wins over
// its transparent twin (Red before Trans-Red — same RGB).
function nearestLegoColours(rgb, options, n) {
  var scored = [];
  (options || []).forEach(function (name) {
    var ref = LEGO_COLOUR_RGB[name];
    if (!ref) return;
    var dr = rgb.r - ref[0], dg = rgb.g - ref[1], db = rgb.b - ref[2];
    scored.push({ colour: name, d: dr * dr + dg * dg + db * db });
  });
  scored.sort(function (a, b) { return (a.d - b.d) || (a.colour < b.colour ? -1 : 1); });
  return scored.slice(0, n || 3).map(function (s) { return s.colour; });
}

// Average colour of a canvas region, ignoring near-white pixels so
// a pale surface doesn't wash the piece out. box is in the image's
// own pixels (a Brickognize bounding_box); it is scaled onto the
// canvas when the two differ in size. No box means the centre 40%
// square — the piece is usually centred. Returns { r, g, b } or
// null when nothing usable was sampled (no canvas, no pixels, or
// every pixel near-white, as with a white piece on a white surface
// photographed too bright — then the caller falls back to the
// last-used colour). Large regions are stride-sampled to ~40k
// pixels so a full video frame doesn't stall the confirm card.
function sampleCanvasColour(canvas, box) {
  if (!canvas || !canvas.getContext) return null;
  var ctx = canvas.getContext('2d');
  if (!ctx || !ctx.getImageData || !canvas.width || !canvas.height) return null;
  var x0, y0, x1, y1;
  if (box && isFinite(box.left) && isFinite(box.upper) && isFinite(box.right) && isFinite(box.lower) && box.image_width > 0 && box.image_height > 0) {
    var sx = canvas.width / box.image_width, sy = canvas.height / box.image_height;
    x0 = Math.max(0, Math.floor(box.left * sx));
    y0 = Math.max(0, Math.floor(box.upper * sy));
    x1 = Math.min(canvas.width, Math.ceil(box.right * sx));
    y1 = Math.min(canvas.height, Math.ceil(box.lower * sy));
  } else {
    var w = Math.floor(canvas.width * 0.4), h = Math.floor(canvas.height * 0.4);
    x0 = Math.floor((canvas.width - w) / 2);
    y0 = Math.floor((canvas.height - h) / 2);
    x1 = x0 + w;
    y1 = y0 + h;
  }
  if (x1 <= x0 || y1 <= y0) return null;
  var img;
  try { img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0); } catch (e) { return null; }
  var d = img && img.data;
  if (!d || !d.length) return null;
  var step = Math.max(1, Math.floor(Math.sqrt((x1 - x0) * (y1 - y0) / 40000)));
  var r = 0, g = 0, b = 0, n = 0;
  for (var i = 0; i + 2 < d.length; i += 4 * step) {
    var pr = d[i], pg = d[i + 1], pb = d[i + 2];
    if (pr > 250 && pg > 250 && pb > 250) continue;
    r += pr; g += pg; b += pb; n++;
  }
  if (!n) return null;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

// Sample the colour of the piece just identified, off the captured
// frame (scanCanvas holds the exact frame that was submitted for
// the camera path, and the picked photo at natural size for the
// file path). Returns { colour, top3, rgb } or null.
function sampleScanColour(box, options) {
  var rgb = sampleCanvasColour(scanCanvas, box);
  if (!rgb) return null;
  var top = nearestLegoColours(rgb, options, 3);
  if (!top.length) return null;
  return { colour: top[0], top3: top, rgb: rgb };
}

async function identifyPart(blob, photo) {
  if (scanState.identifying) return;
  // Brickognize is keyless at ~1 request/sec — don't stack calls.
  if (Date.now() - scanState.lastRequestAt < 1100) {
    scanStatusEl.textContent = 'Wait a moment, then scan again.';
    return;
  }
  scanState.identifying = true;
  scanState.lastRequestAt = Date.now();
  scanCaptureBtn.disabled = true;
  scanStatusEl.textContent = 'Identifying…';
  try {
    var fd = new FormData();
    fd.append('query_image', blob, 'part.jpg');
    var res = await fetch('https://api.brickognize.com/predict/parts/', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('http ' + res.status);
    var data = await res.json();
    var found = parseBrickognizeResponse(data);
    if (!found) {
      scanStatusEl.textContent = 'No part recognised — try again, closer up on a plain background.';
      return;
    }
    handleIdentified(scanState.listId, found.part, found.name, found.score, photo, found.box);
  } catch (e) {
    scanStatusEl.textContent = 'Identification failed — check your connection and try again.';
  } finally {
    scanState.identifying = false;
    scanCaptureBtn.disabled = false;
  }
}

// The piece is added the moment it is identified; the confirm card
// lets Joseph fix the colour and the quantity, and Cancel takes it
// back out. pending.qty is this scan's copies; pending.base is how
// many of this part+colour were already in the list, so the stepper
// and Cancel both count from the right starting point. The colour
// starts as the sampled colour when the photo gives one (v3.36) —
// the top-3 chips sit above the picker for a one-tap correction —
// else the last-used colour, else Black. pending.sampledTop3 keeps
// the chips around so a colour change re-renders their active state.
function handleIdentified(listId, part, name, score, photo, box) {
  ensureScanOverlay();
  var list = findBulkList(listId);
  if (!list) return;
  var options = scanColourOptions();
  var sampled = sampleScanColour(box, options);
  var colour = sampled ? sampled.colour
    : ((scanState.lastColour && options.indexOf(scanState.lastColour) >= 0)
      ? scanState.lastColour : 'Black');
  if (sampled) scanState.lastColour = colour;
  var base = bulkListQty(list, part, colour);
  addScannedPart(listId, part, name, colour);
  scanState.pending = { listId: listId, part: part, name: name, colour: colour, qty: 1, base: base, sampledTop3: sampled ? sampled.top3 : null };
  scanPhotoEl.src = photo || '';
  scanPartNumEl.textContent = part;
  scanPartNameEl.textContent = name || 'Unknown part';
  scanScoreEl.textContent = (score === null) ? '' :
    (score < 0.6 ? 'Low confidence (' + Math.round(score * 100) + '%) — check the number before trusting it.'
                 : 'Confidence ' + Math.round(score * 100) + '%');
  scanColourSel.innerHTML = '';
  options.forEach(function (c) {
    var opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    scanColourSel.appendChild(opt);
  });
  scanColourSel.value = colour;
  renderScanChips(scanState.pending.sampledTop3);
  syncScanQty();
  updateScanMeta();
  scanControlsEl.hidden = true;
  scanVideo.hidden = true;
  scanConfirmEl.hidden = false;
}
// The sampled-colour chips: the top-3 nearest colours as one-tap
// buttons above the picker. The manual picker stays the override —
// a chip tap is just a faster way to pick. Hidden when the photo
// gave no sample.
function renderScanChips(names) {
  if (!scanChipsEl) return;
  scanChipsEl.innerHTML = '';
  if (!names || !names.length) { scanChipsEl.hidden = true; return; }
  scanChipsEl.hidden = false;
  scanChipsEl.appendChild(el('span', 'scan-chips-label', 'Looks like: '));
  names.forEach(function (name) {
    var b = el('button', 'btn btn-small scan-chip' + ((scanState.pending && scanState.pending.colour === name) ? ' on' : ''), name);
    b.type = 'button';
    b.addEventListener('click', function () { onScanColourChange(name); });
    scanChipsEl.appendChild(b);
  });
}
// Quantity stepper: the bulk list holds base + qty copies of this
// scan's part+colour. The floor is 1 — a scan always adds at least
// one piece; Cancel is how a scan is undone entirely.
function setScanQty(n) {
  var p = scanState.pending;
  if (!p) return;
  n = Math.max(1, n);
  p.qty = n;
  setScannedQty(p.listId, p.part, p.colour, p.base + n);
  syncScanQty();
  updateScanMeta();
}
function syncScanQty() {
  var p = scanState.pending;
  var n = p ? p.qty : 1;
  if (scanQtyEl) scanQtyEl.textContent = String(n);
  if (scanQtyMinusBtn) scanQtyMinusBtn.disabled = n <= 1;
}
function updateScanMeta() {
  if (!scanState.pending) return;
  var list = findBulkList(scanState.pending.listId);
  scanMetaEl.textContent = list
    ? 'Added to ' + list.name + ' — ' + bulkListPieces(list) + ' pieces in this list.'
    : '';
}
function onScanColourChange(newColour) {
  var p = scanState.pending;
  if (!p || !newColour || newColour === p.colour) return;
  // Move this scan's copies (not the whole row) to the new colour.
  setScannedQty(p.listId, p.part, p.colour, p.base);
  var list = findBulkList(p.listId);
  var baseNew = list ? bulkListQty(list, p.part, newColour) : 0;
  for (var i = 0; i < p.qty; i++) addScannedPart(p.listId, p.part, p.name, newColour);
  p.colour = newColour;
  p.base = baseNew;
  scanState.lastColour = newColour;
  // A chip tap changes the colour without touching the select, so
  // keep the picker and the chips showing the same colour.
  if (scanColourSel) scanColourSel.value = newColour;
  renderScanChips(p.sampledTop3);
  updateScanMeta();
}
function confirmScanDone() {
  var p = scanState.pending;
  scanState.pending = null;
  scanConfirmEl.hidden = true;
  if (p) { showScanAssign(p); return; }
  scanControlsEl.hidden = false;
  scanVideo.hidden = false;
  scanStatusEl.textContent = 'Point the camera at the next piece and tap Scan piece.';
}
function cancelScanPending() {
  var p = scanState.pending;
  // Take this scan's copies back out, leaving whatever was already
  // in the list (base) untouched.
  if (p) setScannedQty(p.listId, p.part, p.colour, p.base);
  scanState.pending = null;
  scanConfirmEl.hidden = true;
  scanControlsEl.hidden = false;
  scanVideo.hidden = false;
  scanStatusEl.textContent = 'Piece removed — scan the next one when ready.';
}

/* ---------- Scan assignment popup (v3.35) ----------
 * Done on the confirm card asks where this piece goes. The bulk
 * list is always the first row — the piece is already there, so
 * that tap just keeps it. Below it, every tracked set that still
 * needs this exact part + colour, each with its need for the piece
 * and its overall progress. A tap on a set moves the piece out of
 * the bulk list and credits it as found there, through the same
 * applyFoundTo path the All-view minus tap uses. If no tracked set
 * needs it, the bulk-list row stands alone with a note saying so.
 * Unlike setsNeedingPart (selected sets only, for the minus tap),
 * this covers all tracked sets — and it reads the saved counts
 * straight from local storage, because a set that isn't selected
 * has no counts map in memory yet. */
var scanAssignModal = null, scanAssignList = null, scanAssignSub = null, scanAssignNote = null;
var scanAssignPending = null;
function ensureScanAssignModal() {
  if (scanAssignModal) return scanAssignModal;
  var overlay = document.createElement('div');
  overlay.className = 'confirm-modal scan-assign';
  overlay.hidden = true;
  var box = document.createElement('div');
  box.className = 'confirm-box';
  var title = document.createElement('h3');
  title.textContent = 'Where should this piece go?';
  box.appendChild(title);
  scanAssignSub = document.createElement('p');
  box.appendChild(scanAssignSub);
  scanAssignList = document.createElement('div');
  box.appendChild(scanAssignList);
  scanAssignNote = document.createElement('p');
  scanAssignNote.className = 'muted small';
  scanAssignNote.hidden = true;
  box.appendChild(scanAssignNote);
  var cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'btn btn-quiet'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeScanAssign);
  box.appendChild(cancel);
  overlay.appendChild(box);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeScanAssign(); });
  document.body.appendChild(overlay);
  scanAssignModal = overlay;
  return overlay;
}
function hideScanAssign() {
  if (scanAssignModal) scanAssignModal.hidden = true;
  scanAssignPending = null;
}
function resumeScanAfterAssign() {
  scanControlsEl.hidden = false;
  scanVideo.hidden = false;
  scanStatusEl.textContent = 'Point the camera at the next piece and tap Scan piece.';
}
function closeScanAssign() { // Cancel / overlay / Escape: the piece stays in the bulk list
  if (!scanAssignModal || scanAssignModal.hidden) return;
  hideScanAssign();
  resumeScanAfterAssign();
}
// Found / total pieces for one tracked set, from the saved counts
// (the same numbers the sidebar percent is built from). With
// excludeMinifig, minifigure lots are left out of both numbers, so
// the optimizer's remaining count drops by exactly the minifig
// pieces still to find.
function setFoundTotal(setKey, excludeMinifig) {
  var inv = getInventory(setKey);
  if (!inv) return { found: 0, total: 0 };
  var meta = findSet(setKey);
  var counts = LS.get(countsKey(meta ? meta.set_num : setKey), null);
  var found = 0, total = 0;
  inv.items.forEach(function (it) {
    if (excludeMinifig && isMinifigLot(it)) return;
    total += it.qty;
    var rem = (counts && typeof counts[it.id] === 'number') ? Math.max(0, Math.min(it.qty, counts[it.id])) : it.qty;
    found += (it.qty - rem);
  });
  return { found: found, total: total };
}
// Every tracked set that still needs this exact scanned piece — one
// entry per set, with the set's total need for the piece and its
// overall progress. A set holding the same part in two lots gets one
// row, and the credited lot is the first lot of the piece with room.
function setsNeedingScannedPart(part, colour) {
  var pk = part + '|' + colour;
  var out = [];
  sets.forEach(function (meta) {
    var key = meta.key || meta.set_num;
    var inv = getInventory(key);
    if (!inv) return;
    var counts = LS.get(countsKey(meta.set_num), null);
    var rem = 0, lot = null;
    inv.items.forEach(function (l) {
      if (partNumOf(l) + '|' + (l.colour || '') !== pk) return;
      var r = (counts && typeof counts[l.id] === 'number') ? Math.max(0, Math.min(l.qty, counts[l.id])) : l.qty;
      if (r <= 0) return;
      if (!lot) {
        var copy = {};
        for (var k in l) copy[k] = l[k];
        copy.setKey = key;
        lot = copy;
      }
      rem += r;
    });
    if (rem <= 0 || !lot) return;
    var prog = setFoundTotal(key);
    out.push({ setKey: key, setName: meta.set_name || key, lot: lot, rem: rem, found: prog.found, total: prog.total });
  });
  return out;
}
// Credit n finds of this piece to a set, spilling across that
// set's lots of the same part+colour when the first lot runs out
// (a set can hold the same part in two lots). One changeRemaining
// call per lot touched, so the sounds and the card refresh fire once
// per lot, not once per piece.
function applyFoundToN(candidate, n) {
  var setKey = candidate.setKey;
  var pk = partKeyOf(candidate.lot);
  var left = n;
  var inv = getInventory(setKey);
  if (inv) {
    for (var i = 0; i < inv.items.length && left > 0; i++) {
      var lot = inv.items[i];
      if (partNumOf(lot) + '|' + (lot.colour || '') !== pk) continue;
      var copy = {};
      for (var k in lot) copy[k] = lot[k];
      copy.setKey = setKey;
      var rem = remOf(copy);
      if (rem <= 0) continue;
      var d = Math.min(rem, left);
      changeRemaining(copy, -d);
      left -= d;
    }
  }
  lastMinusSet[pk] = setKey;
  if (setRemForPart(setKey, pk) === 0) {
    var prefs = loadHuntPrefs();
    if (prefs[pk]) { delete prefs[pk]; saveHuntPrefs(prefs); }
  }
}
function assignScannedToSet(candidate, p) {
  // The set may not be selected, so its counts map may not be in
  // memory: load it first, or changeRemaining would start that lot
  // from full qty and save a partial map, wiping the set's counts.
  if (!remainingBySet[candidate.setKey]) remainingBySet[candidate.setKey] = loadCounts(candidate.setKey);
  // Credit up to what the set still needs — never over-credit. Any
  // remainder of the scanned quantity stays in the bulk list.
  var n = Math.min(p.qty || 1, candidate.rem);
  applyFoundToN(candidate, n);
  removeScannedPart(p.listId, p.part, p.colour, n);
  hideScanAssign();
  resumeScanAfterAssign();
}
function showScanAssign(p) {
  var m = ensureScanAssignModal();
  scanAssignPending = p;
  var list = findBulkList(p.listId);
  scanAssignSub.textContent = p.part + ' · ' + (p.name || 'Unknown part') + ' · ' + p.colour + ((p.qty || 1) > 1 ? ' ×' + p.qty : '');
  scanAssignList.innerHTML = '';
  // Bulk list first, always — the piece is already there.
  var bulkBtn = document.createElement('button');
  bulkBtn.type = 'button'; bulkBtn.className = 'hunt-choice assign-bulk';
  bulkBtn.textContent = 'Add to bulk list';
  var bulkDetail = document.createElement('div');
  bulkDetail.className = 'assign-detail';
  bulkDetail.textContent = list ? list.name + ' · ' + bulkListPieces(list) + ' pieces' : 'Bulk list';
  bulkBtn.appendChild(bulkDetail);
  bulkBtn.addEventListener('click', function () { hideScanAssign(); resumeScanAfterAssign(); });
  scanAssignList.appendChild(bulkBtn);
  var candidates = setsNeedingScannedPart(p.part, p.colour);
  candidates.forEach(function (c) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'hunt-choice';
    btn.textContent = c.setName;
    var detail = document.createElement('div');
    detail.className = 'assign-detail';
    detail.textContent = 'Needs ' + c.rem + ' · ' + c.found + '/' + c.total + ' pieces found';
    btn.appendChild(detail);
    btn.addEventListener('click', function () { assignScannedToSet(c, p); });
    scanAssignList.appendChild(btn);
  });
  scanAssignNote.textContent = candidates.length ? '' : 'No tracked set still needs this piece.';
  scanAssignNote.hidden = candidates.length > 0;
  m.hidden = false;
}

/* ---------- Order remaining: BrickLink XML wanted list (v3.33) ----------
 * (v3.34 adds the same lines as a BrickStore .bsx, the file
 * BrickLink's upload picker takes — the picker rejects .xml.)
 * The remaining parts (needed minus found, per part + colour, summed
 * across the selected sets) as a BrickLink XML wanted list, the format
 * Rebrickable's wanted-list import takes: ITEMTYPE P, ITEMID the part
 * number, COLOR the BrickLink colour id, MINQTY the remaining count,
 * CONDITION N. Export only — nothing opens Rebrickable. Any-colour
 * lots are ordered in the colour pictured in the photo. Part numbers
 * go through the Rebrickable → BrickLink map (v3.35): most numbers
 * pass through unchanged, the 14 renumbered parts are translated,
 * minifigs export as type M with colour 0, and the chain orders per
 * link (×21). Lots the export can't represent — sticker sheets,
 * colours with no verified BrickLink id, and parts with no known
 * BrickLink number (a rock monster in an unmapped colour) — are left
 * out and listed, never guessed. */
function remainingLines() {
  var byKey = {};
  var order = [];
  var skipped = [];
  var pieces = 0;
  selectedKeys.forEach(function (key) {
    var inv = getInventory(key);
    if (!inv) return;
    inv.items.forEach(function (lot) {
      var copy = {};
      for (var k in lot) copy[k] = lot[k];
      copy.setKey = key;
      var rem = remOf(copy);
      if (rem <= 0) return;
      pieces += rem; // all pieces still needed, exported or skipped
      if (lot.cat === 'Stickers') {
        skipped.push({ part: partNumOf(lot), colour: displayColour(lot), qty: rem, reason: 'sticker sheet — order by set number on BrickLink' });
        return;
      }
      var blp = brickLinkPartFor(lot, rem);
      if (blp.skip) {
        skipped.push({ part: partNumOf(lot), colour: displayColour(lot), qty: rem, reason: blp.skip });
        return;
      }
      var k = blp.id + '|' + blp.type + '|' + blp.colour;
      if (!byKey[k]) { byKey[k] = { part: blp.id, type: blp.type, colour: blp.colour, qty: 0 }; order.push(byKey[k]); }
      byKey[k].qty += blp.qty;
    });
  });
  order.sort(function (a, b) {
    var c = String(a.part).localeCompare(String(b.part), undefined, { numeric: true });
    if (c !== 0) return c;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return a.colour - b.colour;
  });
  return { items: order, pieces: pieces, skipped: skipped };
}
function remainingXml() {
  var r = remainingLines();
  var lines = ['<INVENTORY>'];
  r.items.forEach(function (it) {
    lines.push('  <ITEM>');
    lines.push('    <ITEMTYPE>' + (it.type || 'P') + '</ITEMTYPE>');
    lines.push('    <ITEMID>' + it.part + '</ITEMID>');
    lines.push('    <COLOR>' + it.colour + '</COLOR>');
    lines.push('    <MINQTY>' + it.qty + '</MINQTY>');
    lines.push('    <CONDITION>N</CONDITION>');
    lines.push('  </ITEM>');
  });
  lines.push('</INVENTORY>');
  return { xml: lines.join('\n'), lines: r.items.length, pieces: r.pieces, skipped: r.skipped };
}

/* ---------- Order remaining: BrickStore .bsx (v3.34) ----------
 * Same remaining lines as the XML, as a BrickStore file BrickLink's
 * file picker accepts. Joseph hit the bug live 2026-11-25: the
 * picker takes BrickStock/Brickstore (.bsx), LDraw (.ldr), LEGO
 * Digital Designer (.lxf) and Studio (.io) — a .xml file is "not
 * supported" there; BrickLink XML is paste-only, via the "Upload
 * BrickLink XML format" tab. Schema: BrickStore's own
 * BrickStoreXML.rnc (github.com/rgriebl/brickstore, main branch) —
 * root <BrickStoreXML>, <Inventory> of <Item>, required ItemID,
 * ItemTypeID (1 char), ColorID; Qty and Condition ("N" new) optional
 * but written here; no DOCTYPE. Same lines as the XML export, so
 * the wanted list it builds is identical. */
function remainingBsx() {
  var r = remainingLines();
  var lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<BrickStoreXML>', '  <Inventory>'];
  r.items.forEach(function (it) {
    lines.push('    <Item>');
    lines.push('      <ItemID>' + it.part + '</ItemID>');
    lines.push('      <ItemTypeID>' + (it.type || 'P') + '</ItemTypeID>');
    lines.push('      <ColorID>' + it.colour + '</ColorID>');
    lines.push('      <Qty>' + it.qty + '</Qty>');
    lines.push('      <Condition>N</Condition>');
    lines.push('    </Item>');
  });
  lines.push('  </Inventory>', '</BrickStoreXML>');
  return { bsx: lines.join('\n'), lines: r.items.length, pieces: r.pieces, skipped: r.skipped };
}

var orderModal = null, orderXmlText = null, orderStatusEl = null, orderSummaryEl = null, orderSkippedEl = null;
var orderBsxBtn = null, orderXmlBtn = null, orderCopyBtn = null;
var lastRemainingXml = '';
var lastRemainingBsx = '';
function ensureOrderModal() {
  if (orderModal) return orderModal;
  var overlay = document.createElement('div');
  overlay.className = 'confirm-modal order-modal';
  overlay.hidden = true;
  var box = document.createElement('div');
  box.className = 'confirm-box';
  var title = document.createElement('h3');
  title.textContent = 'Order remaining';
  box.appendChild(title);
  orderSummaryEl = document.createElement('p');
  box.appendChild(orderSummaryEl);
  orderSkippedEl = document.createElement('p');
  orderSkippedEl.className = 'muted small';
  box.appendChild(orderSkippedEl);
  orderXmlText = document.createElement('textarea');
  orderXmlText.className = 'order-xml';
  orderXmlText.readOnly = true;
  orderXmlText.rows = 10;
  orderXmlText.addEventListener('click', function () { if (orderXmlText.select) orderXmlText.select(); });
  box.appendChild(orderXmlText);
  orderStatusEl = document.createElement('p');
  orderStatusEl.className = 'auth-msg';
  box.appendChild(orderStatusEl);
  var row = document.createElement('div');
  row.className = 'confirm-buttons';
  // Each export is labelled with where it goes (v3.34): the .bsx is
  // the file BrickLink's upload picker takes; the XML text is pasted
  // into BrickLink's "Upload BrickLink XML format" tab — the picker
  // rejects a .xml file outright. The .xml download is for
  // Rebrickable's wanted-list import, which takes the file.
  var dlBsx = document.createElement('button');
  dlBsx.type = 'button'; dlBsx.className = 'btn'; dlBsx.textContent = 'Download .bsx — choose this file in BrickLink’s upload picker';
  dlBsx.addEventListener('click', downloadRemainingBsx);
  row.appendChild(dlBsx);
  orderBsxBtn = dlBsx;
  var dl = document.createElement('button');
  dl.type = 'button'; dl.className = 'btn'; dl.textContent = 'Download .xml — Rebrickable import';
  dl.addEventListener('click', downloadRemainingXml);
  row.appendChild(dl);
  orderXmlBtn = dl;
  var cp = document.createElement('button');
  cp.type = 'button'; cp.className = 'btn'; cp.textContent = 'Copy XML — paste into BrickLink’s “Upload BrickLink XML format” tab';
  cp.addEventListener('click', copyRemainingXml);
  row.appendChild(cp);
  orderCopyBtn = cp;
  var close = document.createElement('button');
  close.type = 'button'; close.className = 'btn btn-quiet'; close.textContent = 'Close';
  close.addEventListener('click', hideOrderModal);
  row.appendChild(close);
  box.appendChild(row);
  overlay.appendChild(box);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) hideOrderModal(); });
  document.body.appendChild(overlay);
  orderModal = overlay;
  return overlay;
}
function showOrderModal() {
  var m = ensureOrderModal();
  var r = remainingXml();
  lastRemainingXml = r.xml;
  lastRemainingBsx = remainingBsx().bsx;
  orderXmlText.value = r.xml;
  orderSummaryEl.textContent = r.lines
    ? r.lines + ' lines · ' + r.pieces + ' pieces · condition new — .bsx goes in BrickLink’s file picker; XML goes in BrickLink’s “Upload BrickLink XML format” tab (or import the .xml into Rebrickable).'
    : 'Nothing left to order — every lot in this view is complete.';
  orderSkippedEl.textContent = r.skipped.length
    ? 'Not in the file (' + r.skipped.length + ' lot' + (r.skipped.length === 1 ? '' : 's') + '): ' + r.skipped.map(function (s) { return s.part + ' ' + s.colour + ' ×' + s.qty + ' (' + s.reason + ')'; }).join('; ') + '. Any-colour lots are ordered in the colour pictured.'
    : 'Any-colour lots are ordered in the colour pictured.';
  orderStatusEl.textContent = '';
  m.hidden = false;
}
function hideOrderModal() { if (orderModal) orderModal.hidden = true; }
function downloadRemainingBsx() {
  try {
    var name = 'bulk-finder-remaining-' + (selectedKeys.join('-') || 'sets') + '.bsx';
    var blob = new Blob([lastRemainingBsx], { type: 'application/xml' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    orderStatusEl.textContent = 'Downloaded ' + name + ' — choose it in BrickLink’s upload picker.';
  } catch (e) {
    orderStatusEl.textContent = 'Download didn\'t work here — use Copy instead.';
  }
}
function downloadRemainingXml() {
  try {
    var name = 'bulk-finder-remaining-' + (selectedKeys.join('-') || 'sets') + '.xml';
    var blob = new Blob([lastRemainingXml], { type: 'text/xml' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    orderStatusEl.textContent = 'Downloaded ' + name + ' — import it into Rebrickable’s wanted list.';
  } catch (e) {
    orderStatusEl.textContent = 'Download didn\'t work here — use Copy instead.';
  }
}
function copyRemainingXml() {
  function done() { orderStatusEl.textContent = 'Copied — paste it into BrickLink’s “Upload BrickLink XML format” tab.'; }
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(lastRemainingXml).then(done, function () {
      if (orderXmlText.select) orderXmlText.select();
      orderStatusEl.textContent = 'Copy didn\'t work — the text is selected, copy it by hand.';
    });
  } else {
    if (orderXmlText.select) orderXmlText.select();
    orderStatusEl.textContent = 'Text selected — copy it by hand.';
  }
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
  $('scanBtn').addEventListener('click', openScanPicker);
  // "Displayed" columns control (sidebar footer): - / + buttons and a
  // typeable number; always edits the setting for the device in hand.
  $('colsMinusBtn').addEventListener('click', function () { setCols(getCols(colsBand()) - 1); });
  $('colsPlusBtn').addEventListener('click', function () { setCols(getCols(colsBand()) + 1); });
  $('colsInput').addEventListener('change', function (e) { setCols(e.target.value); });
  // Resizing across the phone/laptop boundary switches which saved
  // value the grid (and the control) shows.
  window.addEventListener('resize', applyCols);
  $('menuBtn').addEventListener('click', toggleDrawer);
  $('drawerBackdrop').addEventListener('click', closeDrawer);
  // Edge swipe opens the drawer on a phone (v3.30).
  document.addEventListener('touchstart', function (e) {
    if (!e.touches || !e.touches.length) return;
    drawerSwipeStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!e.touches || !e.touches.length) return;
    drawerSwipeMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  document.addEventListener('touchend', drawerSwipeEnd, { passive: true });
  document.addEventListener('touchcancel', drawerSwipeEnd, { passive: true });
  // Grip drag on a set box (v3.33): the grip's pointerdown lifts the
  // row at once; these document handlers run the drag itself.
  document.addEventListener('pointermove', function (e) {
    if (dragActive) { dragMoveTo(e.clientY); return; }
  });
  document.addEventListener('pointerup', function () {
    if (dragActive) endSetDrag();
  });
  document.addEventListener('pointercancel', function () {
    if (dragActive) endSetDrag();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeDrawer(); hideConfirm(); hideHuntChooser(); closeScanAssign(); closeScan(); hideOrderModal(); hideScanPicker(); } });
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
  window.addEventListener('online', function () { updateSyncStatus(); tickSync(); refreshSessionIfLoggedOut(); });
  window.addEventListener('offline', updateSyncStatus);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { tickSync(); refreshSessionIfLoggedOut(); }
  });
  // Every 20s: push what's queued, then pull what other devices changed.
  setInterval(tickSync, 20000);
}

async function init() {
  bindEvents();
  setSoundOn(soundOn);
  applyCols();
  sets = localSets();
  bulkLists = loadBulkLists();
  // v3.30 — first paint comes from the local cache: the sets and the
  // saved view show at once, before the login check has had its say.
  // The login check and the cloud merge run in the background below
  // and re-render when they land.
  renderAuth();
  renderSets();
  restoreStartupView();
  viewRestored = true;
  updateSyncStatus();
  // Inventories for imported sets arrive in the background; the view
  // re-renders when they land (8961-1 is baked in, so it shows now).
  loadInventoriesForSets().then(function () { if (viewRestored) loadSelected(); });
  if (!sb) {
    // Supabase CDN failed (offline on first load): guest mode still works.
    $('syncStatus').textContent = 'Offline — guest mode, saved on this phone';
    $('authToggleBtn').disabled = true;
    $('authToggleBtn').textContent = 'Log in unavailable offline';
    return;
  }
  // While the saved login is being checked, say so — the Log in
  // button must not invite a tap before the restore has had its say.
  $('authToggleBtn').textContent = 'Checking login…';
  $('authToggleBtn').disabled = true;
  try {
    var sess = await sb.auth.getSession();
    if (sess.data && sess.data.session && sess.data.session.user) {
      user = sess.data.session.user;
      subscribeLive();
      await refreshSetsFromCloud();
      renderAuth();
      renderSets();
      if (selectedKeys.length) loadSelected();
    } else {
      renderAuth(); // restores the Log in button
    }
    sb.auth.onAuthStateChange(handleAuthChange);
  } catch (e) {
    console.warn('auth check failed, continuing as guest', e);
    renderAuth();
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
  // A signup-confirm link lands here the same way (#...&type=signup):
  // the session is in place and the app shows logged-in, but the token
  // stays in the address bar — a reload or a shared link replays it.
  clearAuthHashIfLanded();
}

// Restore today's view (filters + set selection); a new day starts
// fresh at Still needed with the first set open — never All (v3.30:
// opening every set at once is what made startup crawl).
function restoreStartupView() {
  var sameDay = loadViewState();
  var last = LS.get('bf:activeSet', null);
  var savedSel = loadSelectedKeys();
  if (sameDay && savedSel && savedSel.length && savedSel.every(function (k) { return findSet(k); })) {
    // A saved all-sets selection opens just the first set instead.
    if (savedSel.length === sets.length && sets.length > 1) {
      selectedKeys = [sets[0].key];
    } else {
      selectedKeys = savedSel;
    }
    activeSetKey = (last && selectedKeys.indexOf(last) >= 0) ? last : selectedKeys[0];
    loadSelected();
  } else if (!sameDay && sets.length) {
    activeSetKey = sets[0].key;
    LS.set('bf:activeSet', activeSetKey);
    setSelected([sets[0].key]);
  } else if (last && findSet(last)) openSet(last);
  else if (sets.length) openSet(sets[0].key);
  else showEmpty();
}

document.addEventListener('DOMContentLoaded', init);

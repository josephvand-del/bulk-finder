/* Bulk Finder v3.0 — multi-set LEGO bulk-hunt tracker.
 *
 * Single-page app, no framework. Static files on GitHub Pages.
 * Backend: Supabase (Postgres + Auth). The app is LOCAL-FIRST:
 * every tap saves to this device immediately (localStorage), then
 * syncs to Supabase in the background with a retry queue when the
 * user is logged in and online. A failed sync never wipes local
 * progress — the queue just retries later.
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
var INVENTORY_8961 = {"set": "8961-1 Crystal Sweeper", "lots": 138, "pieces": 430, "tiers": {"1": "MOST LIKELY IN BULK", "2": "MEDIUM \u2014 WORTH A DIG", "3": "LEAST LIKELY IN BULK"}, "items": [{"id": "300126-3001-Black", "qty": 16, "dim": "2 \u00d7 4 studs", "colour": "Black", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/300126.jpg"}, {"id": "4121715-2780-Black", "qty": 8, "dim": "2 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Pins", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4121715.jpg"}, {"id": "614126-6141-Black", "qty": 4, "dim": "1 \u00d7 1 studs", "colour": "", "any": true, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/614126.jpg"}, {"id": "4535739-63868-Black", "qty": 4, "dim": "2 \u00d7 1 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4535739.jpg"}, {"id": "4556158-60470-Black", "qty": 4, "dim": "1 \u00d7 2 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4556158.jpg"}, {"id": "302026-3020-Black", "qty": 2, "dim": "2 \u00d7 4 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/302026.jpg"}, {"id": "403226-4032-Black", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/403226.jpg"}, {"id": "4569733-88072-Black", "qty": 2, "dim": "1 \u00d7 2 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4569733.jpg"}, {"id": "370826-3708-Black", "qty": 2, "dim": "12 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/370826.jpg"}, {"id": "4526982-62462-Black", "qty": 2, "dim": "2 studs long", "colour": "", "any": true, "tier": 1, "cat": "Tubes and Hoses", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4526982.jpg"}, {"id": "416226-4162-Black", "qty": 2, "dim": "1 \u00d7 8 studs", "colour": "Black", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/416226.jpg"}, {"id": "4158848-30552-Black", "qty": 1, "dim": "1 stud", "colour": "", "any": true, "tier": 1, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4158848.jpg"}, {"id": "370726-3707-Black", "qty": 1, "dim": "8 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/370726.jpg"}, {"id": "4211086-6587-Dark_Stone_Grey", "qty": 13, "dim": "3 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211086.jpg"}, {"id": "4508553-59426-Dark_Stone_Grey", "qty": 4, "dim": "5\u00bd studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4508553.jpg"}, {"id": "4210798-6112-Dark_Stone_Grey", "qty": 2, "dim": "1 \u00d7 12 studs", "colour": "", "any": true, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4210798.jpg"}, {"id": "4211061-3035-Dark_Stone_Grey", "qty": 2, "dim": "4 \u00d7 8 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211061.jpg"}, {"id": "4256149-3028-Dark_Stone_Grey", "qty": 2, "dim": "6 \u00d7 12 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4256149.jpg"}, {"id": "4211055-3068-Dark_Stone_Grey", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211055.jpg"}, {"id": "4211396-3021-Medium_Stone_Grey", "qty": 12, "dim": "2 \u00d7 3 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211396.jpg"}, {"id": "4211622-6590-Medium_Stone_Grey", "qty": 9, "dim": "1 stud", "colour": "", "any": true, "tier": 1, "cat": "Technic Bushes", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211622.jpg"}, {"id": "4521921-54200-Medium_Stone_Grey", "qty": 8, "dim": "1 \u00d7 1 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4521921.jpg"}, {"id": "4211503-4599-Medium_Stone_Grey", "qty": 6, "dim": "1 \u00d7 1 stud", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Random", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211503.jpg"}, {"id": "4211639-32073-Medium_Stone_Grey", "qty": 6, "dim": "5 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211639.jpg"}, {"id": "4515369-60478-Medium_Stone_Grey", "qty": 4, "dim": "1 \u00d7 2 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4515369.jpg"}, {"id": "4211406-3034-Medium_Stone_Grey", "qty": 3, "dim": "2 \u00d7 8 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211406.jpg"}, {"id": "4211397-3022-Medium_Stone_Grey", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211397.jpg"}, {"id": "4211360-2445-Medium_Stone_Grey", "qty": 1, "dim": "2 \u00d7 12 studs", "colour": "", "any": true, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211360.jpg"}, {"id": "4211526-6143-Medium_Stone_Grey", "qty": 1, "dim": "\u00d816 mm", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211526.jpg"}, {"id": "4211696-30388-Medium_Stone_Grey", "qty": 1, "dim": "1 \u00d7 6 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211696.jpg"}, {"id": "4215971-40902-Medium_Stone_Grey", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Light Grey", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4215971.jpg"}, {"id": "4211483-4274-Medium_Stone_Grey", "qty": 1, "dim": "1 stud", "colour": "", "any": true, "tier": 1, "cat": "Technic Pins", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211483.jpg"}, {"id": "4211805-44294-Medium_Stone_Grey", "qty": 1, "dim": "7 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Axles", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211805.jpg"}, {"id": "302201-3022-White", "qty": 3, "dim": "2 \u00d7 2 studs", "colour": "White", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/302201.jpg"}, {"id": "4140583-2540-White", "qty": 3, "dim": "1 \u00d7 2 studs", "colour": "White", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4140583.jpg"}, {"id": "408501-4085-White", "qty": 2, "dim": "1 \u00d7 1 studs", "colour": "White", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/408501.jpg"}, {"id": "4533763-60475-White", "qty": 2, "dim": "1 \u00d7 1 studs", "colour": "White", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4533763.jpg"}, {"id": "379401-3794-White", "qty": 1, "dim": "1 \u00d7 2 studs", "colour": "White", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/379401.jpg"}, {"id": "379501-3795-White", "qty": 1, "dim": "2 \u00d7 6 studs", "colour": "White", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/379501.jpg"}, {"id": "3005740-30057-Transparent", "qty": 6, "dim": "1 \u00d7 1 studs", "colour": "Clear", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/3005740.jpg"}, {"id": "4206482-43093-Bright_Blue", "qty": 6, "dim": "1 stud", "colour": "Blue", "any": false, "tier": 1, "cat": "Technic Bushes", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4206482.jpg"}, {"id": "4239601-32123-Bright_Yellow", "qty": 6, "dim": "\u00bd stud", "colour": "", "any": true, "tier": 1, "cat": "Technic Bushes", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4239601.jpg"}, {"id": "4164022-3004-Bright_Yellowish_Green", "qty": 13, "dim": "1 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4164022.jpg"}, {"id": "4164037-3023-Bright_Yellowish_Green", "qty": 13, "dim": "1 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4164037.jpg"}, {"id": "4220631-3002-Bright_Yellowish_Green", "qty": 10, "dim": "2 \u00d7 3 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4220631.jpg"}, {"id": "4187743-3710-Bright_Yellowish_Green", "qty": 7, "dim": "1 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4187743.jpg"}, {"id": "4212446-6091-Bright_Yellowish_Green", "qty": 6, "dim": "1 \u00d7 1 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4212446.jpg"}, {"id": "4537927-61678-Bright_Yellowish_Green", "qty": 6, "dim": "1 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4537927.jpg"}, {"id": "4164021-2431-Bright_Yellowish_Green", "qty": 4, "dim": "1 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4164021.jpg"}, {"id": "4220632-3003-Bright_Yellowish_Green", "qty": 4, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4220632.jpg"}, {"id": "4160593-2431-Bright_Orange", "qty": 3, "dim": "1 \u00d7 4 studs", "colour": "Orange", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4160593.jpg"}, {"id": "4158355-3020-Bright_Orange", "qty": 2, "dim": "2 \u00d7 4 studs", "colour": "Orange", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4158355.jpg"}, {"id": "4234716-3010-Bright_Yellowish_Green", "qty": 2, "dim": "1 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4234716.jpg"}, {"id": "4500755-52031-Bright_Yellowish_Green", "qty": 2, "dim": "4 \u00d7 6 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4500755.jpg"}, {"id": "4504705-30565-Bright_Yellowish_Green", "qty": 2, "dim": "4 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4504705.jpg"}, {"id": "4529160-3666-Bright_Yellowish_Green", "qty": 2, "dim": "1 \u00d7 6 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4529160.jpg"}, {"id": "4541490-44126-Bright_Yellowish_Green", "qty": 2, "dim": "2 \u00d7 6 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541490.jpg"}, {"id": "3000841-30008-Transparent_Red", "qty": 2, "dim": "1 \u00d7 1 studs", "colour": "Trans-Red", "any": false, "tier": 1, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/3000841.jpg"}, {"id": "4538144-62462-Bright_Orange", "qty": 1, "dim": "2 studs long", "colour": "", "any": true, "tier": 1, "cat": "Tubes and Hoses", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538144.jpg"}, {"id": "4504850-3031-Bright_Yellowish_Green", "qty": 1, "dim": "4 \u00d7 4 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4504850.jpg"}, {"id": "4541957-4150-Bright_Yellowish_Green", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541957.jpg"}, {"id": "4299389-56145-Black", "qty": 6, "dim": "\u00d830 mm", "colour": "Black", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4299389.jpg"}, {"id": "370126-3701-Black", "qty": 2, "dim": "1 \u00d7 4 studs", "colour": "", "any": true, "tier": 2, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/370126.jpg"}, {"id": "4100423-6087-Black", "qty": 2, "dim": "2 \u00d7 5 studs", "colour": "", "any": true, "tier": 2, "cat": "Random", "img": "https://img.bricklink.com/ItemImage/PN/11/6087.png"}, {"id": "4216660-30367-Black", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4216660.jpg"}, {"id": "4244953-50861-Black", "qty": 2, "dim": "\u00d821 mm", "colour": "Black", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4244953.jpg"}, {"id": "4502834-53992-Black", "qty": 2, "dim": "\u22482 studs long", "colour": "Black", "any": false, "tier": 2, "cat": "Technic Special", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4502834.jpg"}, {"id": "4538456-64644-Black", "qty": 2, "dim": "\u22483 studs long", "colour": "Black", "any": false, "tier": 2, "cat": "Minifig Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538456.jpg"}, {"id": "4112282-6629-Black", "qty": 2, "dim": "4 \u00d7 6 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Technic Beams", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4112282.jpg"}, {"id": "602026-6020-Black", "qty": 1, "dim": "1 \u00d7 4 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Bars, Ladders and Fences", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/602026.jpg"}, {"id": "4153044-30663-Black", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Miscellaneous", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4153044.jpg"}, {"id": "4527063-62698-Black", "qty": 1, "dim": "1 \u00d7 2 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Minifig Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4527063.jpg"}, {"id": "4211064-3747-Dark_Stone_Grey", "qty": 8, "dim": "2 \u00d7 3 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211064.jpg"}, {"id": "4210631-2412-Dark_Stone_Grey", "qty": 6, "dim": "1 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4210631.jpg"}, {"id": "4540386-61409-Dark_Stone_Grey", "qty": 4, "dim": "1 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540386.jpg"}, {"id": "4514558-3648-Dark_Stone_Grey", "qty": 3, "dim": "\u00d824 mm", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4514558.jpg"}, {"id": "4161674-30367-Dark_Stone_Grey", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4161674.jpg"}, {"id": "4210645-30170-Dark_Stone_Grey", "qty": 2, "dim": "minifig", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Minifig Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4210645.jpg"}, {"id": "4219725-3633-Dark_Stone_Grey", "qty": 2, "dim": "1 \u00d7 4 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Bars, Ladders and Fences", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4219725.jpg"}, {"id": "4520307-61780-Dark_Stone_Grey", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Random", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4520307.jpg"}, {"id": "4211054-3039-Dark_Stone_Grey", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211054.jpg"}, {"id": "4516456-60169-Dark_Stone_Grey", "qty": 1, "dim": "16 studs long", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "String, Bands and Reels", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4516456.jpg"}, {"id": "4522784-47455-Dark_Stone_Grey", "qty": 1, "dim": "\u22482 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Technic Connectors", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4522784.jpg"}, {"id": "4277927-44728-Medium_Stone_Grey", "qty": 4, "dim": "1 \u00d7 2 studs", "colour": "Light Grey", "any": false, "tier": 2, "cat": "Plates Special", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4277927.jpg"}, {"id": "4211847-30360-Medium_Stone_Grey", "qty": 2, "dim": "3 \u00d7 3 studs", "colour": "Light Grey", "any": false, "tier": 2, "cat": "Technic Steering, Suspension and Engine", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211847.jpg"}, {"id": "4590443-50862-Medium_Stone_Grey", "qty": 2, "dim": "\u00d815 mm", "colour": "Light Grey", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4590443.jpg"}, {"id": "4211819-4515-Medium_Stone_Grey", "qty": 1, "dim": "6 \u00d7 8 studs", "colour": "", "any": true, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211819.jpg"}, {"id": "4523403-60779-White", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "White", "any": false, "tier": 2, "cat": "Flags, Banners and Signs", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4523403.jpg"}, {"id": "4521210-60592-White", "qty": 1, "dim": "1 \u00d7 2 studs", "colour": "White", "any": false, "tier": 2, "cat": "Windows and Doors", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4521210.jpg"}, {"id": "4278412-54196-Transparent", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Clear", "any": false, "tier": 2, "cat": "Plates Round Curved and Dishes", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4278412.jpg"}, {"id": "281721-2817-Bright_Red", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Red", "any": false, "tier": 2, "cat": "Technic Special", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/281721.jpg"}, {"id": "4538780-64728-Bright_Red", "qty": 2, "dim": "\u22481 stud", "colour": "Red", "any": false, "tier": 2, "cat": "Minifig Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538780.jpg"}, {"id": "4540418-30325-Bright_Blue", "qty": 2, "dim": "minifig", "colour": "Blue", "any": false, "tier": 2, "cat": "Minifig Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540418.jpg"}, {"id": "4114584-33085-Bright_Yellow", "qty": 1, "dim": "\u22481 stud", "colour": "Yellow", "any": false, "tier": 2, "cat": "Minifig Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4114584.jpg"}, {"id": "4540385-61409-Bright_Yellowish_Green", "qty": 8, "dim": "1 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540385.jpg"}, {"id": "4494219-4185-Bright_Yellowish_Green", "qty": 8, "dim": "\u00d824 mm", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4494219.jpg"}, {"id": "4540817-32348-Bright_Orange", "qty": 6, "dim": "4 \u00d7 4 studs", "colour": "Orange", "any": false, "tier": 2, "cat": "Technic Beams", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540817.jpg"}, {"id": "4529679-3660-Bright_Yellowish_Green", "qty": 4, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4529679.jpg"}, {"id": "4244369-50746-Transparent_Bright_Orange", "qty": 4, "dim": "1 \u00d7 1 studs", "colour": "Trans-Orange", "any": false, "tier": 2, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4244369.jpg"}, {"id": "4540299-64711-Bright_Orange", "qty": 2, "dim": "\u00d862 mm", "colour": "Orange", "any": false, "tier": 2, "cat": "Wheels and Tyres", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4540299.jpg"}, {"id": "4529045-33243-Bright_Yellowish_Green", "qty": 2, "dim": "1 \u00d7 3 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Bricks Curved", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4529045.jpg"}, {"id": "4261453-6536-Bright_Yellowish_Green", "qty": 2, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Technic Connectors", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4261453.jpg"}, {"id": "4265684-32523-Bright_Yellowish_Green", "qty": 2, "dim": "3 studs long", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Technic Beams", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4265684.jpg"}, {"id": "4508713-32009-Bright_Yellowish_Green", "qty": 2, "dim": "3 \u00d7 7 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Technic Beams", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4508713.jpg"}, {"id": "4119483-30153-Transparent_Blue", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Blue", "any": false, "tier": 2, "cat": "Minifig Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4119483.jpg"}, {"id": "4541538-30385-Transparent_Blue", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Blue", "any": false, "tier": 2, "cat": "Minifig Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541538.jpg"}, {"id": "4541536-30385-Transparent_Bright_Orange", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Orange", "any": false, "tier": 2, "cat": "Minifig Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541536.jpg"}, {"id": "4114505-30153-Transparent_Fluorescent_Green", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Green", "any": false, "tier": 2, "cat": "Minifig Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4114505.jpg"}, {"id": "4541537-30385-Transparent_Red", "qty": 2, "dim": "1 \u00d7 1 stud", "colour": "Trans-Red", "any": false, "tier": 2, "cat": "Minifig Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541537.jpg"}, {"id": "4518029-59900-Bright_Orange", "qty": 1, "dim": "1 \u00d7 1 studs", "colour": "Orange", "any": false, "tier": 2, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4518029.jpg"}, {"id": "4537923-30499-Bright_Yellowish_Green", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Lime Green", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4537923.jpg"}, {"id": "4552036-86209-Transparent_Brown", "qty": 1, "dim": "1 \u00d7 2 studs", "colour": "Trans-Brown", "any": false, "tier": 2, "cat": "Windows and Doors", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4552036.jpg"}, {"id": "4544720-64288-Transparent_Red", "qty": 1, "dim": "1 \u00d7 1 studs", "colour": "Trans-Red", "any": false, "tier": 2, "cat": "Small pieces", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4544720.jpg"}, {"id": "4107558-32018-Black", "qty": 4, "dim": "1 \u00d7 14 studs", "colour": "Black", "any": false, "tier": 3, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4107558.jpg"}, {"id": "4530673-50859-Black", "qty": 1, "dim": "6 studs long", "colour": "Black", "any": false, "tier": 3, "cat": "Transportation - Land", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4530673.jpg"}, {"id": "4539385-64450-Black", "qty": 1, "dim": "4 \u00d7 6 studs", "colour": "Black", "any": false, "tier": 3, "cat": "Miscellaneous", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4539385.jpg"}, {"id": "4211006-3837-Dark_Stone_Grey", "qty": 1, "dim": "\u22483 studs long", "colour": "Dark Grey", "any": false, "tier": 3, "cat": "Minifig Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4211006.jpg"}, {"id": "4542545-76382-Medium_Stone_Grey", "qty": 1, "dim": "minifig torso", "colour": "Light Grey", "any": false, "tier": 3, "cat": "Minifig Upper Body", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542545.jpg"}, {"id": "4538783-64713-Medium_Stone_Grey", "qty": 1, "dim": "4 \u00d7 4 studs", "colour": "Light Grey", "any": false, "tier": 3, "cat": "Bricks Round and Cones", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538783.jpg"}, {"id": "73737-73587-White", "qty": 4, "dim": "\u22482 studs long", "colour": "White", "any": false, "tier": 3, "cat": "Miscellaneous", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/73737.jpg"}, {"id": "4542547-76382-White", "qty": 1, "dim": "minifig torso", "colour": "White", "any": false, "tier": 3, "cat": "Minifig Upper Body", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542547.jpg"}, {"id": "85418-85418-White", "qty": 1, "dim": "sticker sheet", "colour": "White", "any": false, "tier": 3, "cat": "Stickers", "img": "http://media.peeron.com/pics/inv/custpics/thumbs/85418.1246725805.jpg"}, {"id": "4542552-85107-Bright_Blue", "qty": 2, "dim": "minifig legs", "colour": "Blue", "any": false, "tier": 3, "cat": "Minifig Lower Body", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542552.jpg"}, {"id": "4542171-64881-Bright_Yellow", "qty": 1, "dim": "minifig head", "colour": "Yellow", "any": false, "tier": 3, "cat": "Minifig Heads", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542171.jpg"}, {"id": "4542175-64882-Bright_Yellow", "qty": 1, "dim": "minifig head", "colour": "Yellow", "any": false, "tier": 3, "cat": "Minifig Heads", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4542175.jpg"}, {"id": "4281515-41669-Bright_Orange", "qty": 24, "dim": "3 studs long", "colour": "Orange", "any": false, "tier": 3, "cat": "Bionicle, Hero Factory and Constraction", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4281515.jpg"}, {"id": "4508647-2634-{Not_Specified}", "qty": 1, "dim": "2 \u00d7 8 studs", "colour": "White", "any": false, "tier": 3, "cat": "Windows and Doors", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4508647.jpg"}, {"id": "4521107-50860-Bright_Orange", "qty": 1, "dim": "\u22486 studs long", "colour": "Orange", "any": false, "tier": 3, "cat": "Transportation - Land", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4521107.jpg"}, {"id": "4538363-30300-Bright_Orange", "qty": 1, "dim": "8 \u00d7 12 studs", "colour": "Orange", "any": false, "tier": 3, "cat": "Plates Special", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538363.jpg"}, {"id": "4541465-64786-Transparent_Blue", "qty": 1, "dim": "\u22482 \u00d7 2 studs", "colour": "Trans-Blue", "any": false, "tier": 3, "cat": "Minifigs", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4541465.jpg"}, {"id": "4538017-64786-Transparent_Red", "qty": 1, "dim": "\u22482 \u00d7 2 studs", "colour": "Trans-Red", "any": false, "tier": 3, "cat": "Minifigs", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4538017.jpg"}, {"id": "4186017-6562-Brick_Yellow", "qty": 1, "dim": "3 studs long", "colour": "", "any": true, "tier": 1, "cat": "Technic Pins", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4186017.jpg"}, {"id": "4210677-30088-Dark_Stone_Grey", "qty": 1, "dim": "5 studs long", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Minifig Accessories", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4210677.jpg"}, {"id": "4225973-48169-Dark_Stone_Grey", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 3, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4225973.jpg"}, {"id": "4225975-48171-Dark_Stone_Grey", "qty": 1, "dim": "2 \u00d7 2 studs", "colour": "Dark Grey", "any": false, "tier": 3, "cat": "Technic Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4225975.jpg"}, {"id": "4261715-3297-Dark_Stone_Grey", "qty": 2, "dim": "3 \u00d7 4 studs", "colour": "Dark Grey", "any": false, "tier": 2, "cat": "Sloped Bricks", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4261715.jpg"}, {"id": "4528323-60474-Dark_Stone_Grey", "qty": 1, "dim": "4 \u00d7 4 studs", "colour": "Dark Grey", "any": false, "tier": 1, "cat": "Plates", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4528323.jpg"}, {"id": "4517986-61485-Black", "qty": 1, "dim": "4 \u00d7 4 studs", "colour": "Black", "any": false, "tier": 2, "cat": "Hinges, Arms and Turntables", "img": "https://www.lego.com/cdn/product-assets/element.img.lod5photo.192x192/4517986.jpg"}]};
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
 * Tiles fold into Plates — "anything flat is a plate" — and Minifig
 * Headwear folds into Minifig Accessories. Small pieces is the one
 * non-Rebrickable bucket: 1x1 / single-stud bricks and plates.
 * Future sets from the Rebrickable lookup carry their own part_cat_id,
 * so this dropdown works for any set with no hand-mapping.
 *
 * Display rule (Joseph's audit, 2026-11-15): a raw category with only
 * 1-2 lots in the open set folds into 'Miscellaneous' at display time,
 * so tiny sections never get their own dropdown entry. 'Minifigs' is
 * exempt — he placed the rock monster there on purpose. Empty
 * categories never appear: the dropdown is built from the lots that
 * are actually there. */
function itemCat(item) { return item.cat || 'Other'; }

// Lot counts per raw category, per set — rebuilt when the selection loads.
var catLotCount = {};
function rebuildCatCounts() {
  catLotCount = {};
  items.forEach(function (it) {
    var m = catLotCount[it.setKey] || (catLotCount[it.setKey] = {});
    var c = itemCat(it);
    m[c] = (m[c] || 0) + 1;
  });
}

// The category shown in the type dropdown and used by the type filter.
function displayCat(item) {
  var raw = itemCat(item);
  if (raw === 'Miscellaneous' || raw === 'Minifigs') return raw;
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
var statusFilter = 'all';     // all | needed | done
var colourFilter = 'all';     // all | family name
var typeFilter = 'all';       // Rebrickable category name, or 'all'

var SEED_SET = {
  key: '8961-1',
  set_num: '8961-1',
  set_name: 'Crystal Sweeper',
  total_parts: 430,
  total_lots: 138,
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
  var res = await sb.from('set_inventories').select('inventory').eq('set_num', setNum).maybeSingle();
  if (res.error || !res.data || !res.data.inventory) return null;
  INVENTORIES[setNum] = res.data.inventory;
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

// One upsert carrying every lot of a set (used after Reset all).
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
  var res = await sb.from('user_sets')
    .insert({ set_num: meta.set_num, set_name: meta.set_name, total_parts: meta.total_parts, total_lots: meta.total_lots })
    .select().single();
  if (res.error) { console.warn('user_sets insert failed', res.error); return null; }
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
      // Cloud wins.
      var inv = getInventory(meta.set_num);
      var map = {};
      inv.items.forEach(function (it) { map[it.id] = it.qty; });
      rows.forEach(function (r) {
        if (map.hasOwnProperty(r.part_key)) map[r.part_key] = Math.max(0, r.qty_remaining);
      });
      remainingBySet[meta.set_num] = map;
      saveCounts(meta.set_num, map);
    } else {
      await uploadAllParts(userSetId, meta.set_num, remainingBySet[meta.set_num] || loadCounts(meta.set_num));
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
  sets = Object.keys(byNum).map(function (k) { return byNum[k]; });
  // Create cloud rows for local-only sets (their counts upload on open).
  for (var i = 0; i < sets.length; i++) {
    var s = sets[i];
    if (!s.user_set_id) {
      var id = await createCloudSet(s);
      if (id) s.user_set_id = id;
    }
  }
  saveLocalSets(sets.map(function (s) {
    return { key: s.set_num, set_num: s.set_num, set_name: s.set_name, total_parts: s.total_parts, total_lots: s.total_lots, user_set_id: s.user_set_id || null };
  }));
  // Inventories for every set in the list, so openSet can use them.
  await loadInventoriesForSets();
}

/* ---------- Auth ---------- */
function setAuthMsg(msg, ok) {
  var n = $('authMsg');
  n.textContent = msg || '';
  n.className = 'auth-msg' + (ok ? ' ok' : '');
}

async function doLogin() {
  if (!sb) { setAuthMsg('Log in needs a connection — try again when you are online.'); return; }
  var email = $('authEmail').value.trim();
  var password = $('authPassword').value;
  if (!email || !password) { setAuthMsg('Enter an email and password.'); return; }
  setAuthMsg('Logging in…', true);
  var res = await sb.auth.signInWithPassword({ email: email, password: password });
  if (res.error) setAuthMsg(res.error.message);
  else setAuthMsg('Logged in.', true);
}

async function doSignup() {
  if (!sb) { setAuthMsg('Sign up needs a connection — try again when you are online.'); return; }
  var email = $('authEmail').value.trim();
  var password = $('authPassword').value;
  if (!email || !password) { setAuthMsg('Enter an email and password.'); return; }
  if (password.length < 6) { setAuthMsg('Password needs at least 6 characters.'); return; }
  setAuthMsg('Creating your account…', true);
  var res = await sb.auth.signUp({ email: email, password: password });
  if (res.error) { setAuthMsg(res.error.message); return; }
  if (res.data && res.data.session) {
    setAuthMsg('Account created — logged in.', true);
  } else {
    // Email confirmation is on: no session until they confirm.
    setAuthMsg('Check your email to confirm your account, then log in.', true);
  }
}

async function doLogout() {
  if (sb) await sb.auth.signOut();
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

async function handleAuthChange(event, session) {
  user = (session && session.user) ? session.user : null;
  if (user) {
    await refreshSetsFromCloud();
    renderAuth();
    renderSets();
    if (activeSetKey) openSet(activeSetKey);
    else if (sets.length) openSet(sets[0].key);
    updateSyncStatus();
  }
}

function renderAuth() {
  var card = $('authCard');
  var toggle = $('authToggleBtn');
  var logout = $('logoutBtn');
  var chip = $('userChip');
  if (user) {
    card.hidden = true;
    toggle.hidden = true;
    logout.hidden = false;
    chip.hidden = false;
    chip.textContent = user.email || 'Logged in';
  } else {
    toggle.hidden = false;
    logout.hidden = true;
    chip.hidden = true;
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
    total_parts: SEED_SET.total_parts, total_lots: SEED_SET.total_lots, user_set_id: null
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

async function lookupSet() {
  var msg = $('addSetMsg');
  function say(t) { if (msg) msg.textContent = t; }
  var raw = $('setNumInput').value.trim();
  if (!raw) { say('Type a set number first — e.g. 10294-1.'); return; }
  if (!sb || !user) { say('Log in first — adding a set saves it to your account.'); return; }
  var num = normalizeSetNumInput(raw);
  if (findSet(num)) { say('That set is already in your list — open it from the sidebar.'); return; }
  hideAddSetPreview();
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
    total_parts: p.inventory.pieces, total_lots: p.inventory.lots, user_set_id: null
  };
  var local = localSets();
  local.push(meta);
  saveLocalSets(local);
  sets.push(meta);
  var map = {};
  p.inventory.items.forEach(function (it) { map[it.id] = it.qty; });
  saveCounts(p.set_num, map);
  if (user && sb) {
    var id = await createCloudSet(meta);
    if (id) {
      meta.user_set_id = id;
      await uploadAllParts(id, p.set_num, map);
    }
    // If the cloud set failed, the local copy stays; it uploads on next open.
  }
  hideAddSetPreview();
  $('setNumInput').value = '';
  renderSets();
  openSet(meta.key);
  say('Added ' + p.set_num + ' — ' + p.inventory.lots + ' lots, ' + p.inventory.pieces + ' pieces. All lots start at full count.');
  updateSyncStatus();
}


// The sets the combined view shows. Saved on this device.
function loadSelectedKeys() { return LS.get('bf:selectedSets', null); }
function saveSelectedKeys() { LS.set('bf:selectedSets', selectedKeys); }

// Rebuild the combined view from selectedKeys: per-set counts + items
// tagged with their set (copies — the shared inventory is never mutated).
function loadSelected() {
  items = [];
  remainingBySet = {};
  selectedKeys.forEach(function (key) {
    var inv = getInventory(key);
    if (!inv) return;
    remainingBySet[key] = loadCounts(key);
    inv.items.forEach(function (it) {
      var copy = {};
      for (var k in it) copy[k] = it[k];
      copy.setKey = key;
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

// Pick exactly these sets (at least one) and show them together.
function setSelected(keys) {
  var valid = keys.filter(function (k) { return findSet(k); });
  if (!valid.length) return;
  selectedKeys = valid;
  saveSelectedKeys();
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
  loadSelected();
}

// Sidebar click: show just this set. The picker can add more sets on top.
function openSet(key) {
  var meta = findSet(key);
  if (!meta) return;
  activeSetKey = key;
  LS.set('bf:activeSet', key);
  setSelected([key]);
  var im = $('importMsg'); if (im) im.textContent = '';
  if (user && sb) {
    // Cloud merge in the background; re-render if it changed counts.
    ensureCloudSet(meta).then(function () { renderSetView(); updateSyncStatus(); });
  }
  updateSyncStatus();
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
  var current = sel.value || 'all';
  // Remaining pieces per family (trans variants folded into base colours;
  // lots that used to be "any colour" count under their pictured colour).
  var famLeft = {};
  items.forEach(function (it) {
    var rem = remOf(it);
    var fam = familyOf(it);
    famLeft[fam] = (famLeft[fam] || 0) + rem;
  });
  var fams = Object.keys(famLeft).sort(function (a, b) {
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
  sel.value = (current === 'all' || famLeft.hasOwnProperty(current)) ? current : 'all';
  colourFilter = sel.value;
}

function rebuildTypeSelect() {
  var sel = $('typeSelect');
  if (!sel) return;
  var current = sel.value || 'all';
  // Remaining pieces per displayed category — small raw categories fold
  // into Miscellaneous (see displayCat), from the lots actually here.
  var catLeft = {};
  items.forEach(function (it) {
    var rem = remOf(it);
    var c = displayCat(it);
    catLeft[c] = (catLeft[c] || 0) + rem;
  });
  var cats = Object.keys(catLeft).sort(function (a, b) {
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
  sel.value = (current === 'all' || catLeft.hasOwnProperty(current)) ? current : 'all';
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
  selectedKeys.forEach(function (key) {
    var meta = findSet(key);
    if (!meta) return;
    var setItems = items.filter(function (it) { return it.setKey === key; });
    if (!setItems.length) return;
    var inv = getInventory(key);
    var tierNames = inv ? inv.tiers : { 1: 'MOST LIKELY IN BULK', 2: 'MEDIUM — WORTH A DIG', 3: 'LEAST LIKELY IN BULK' };
    // With several sets open, each set gets its own heading.
    if (selectedKeys.length > 1) {
      view.appendChild(el('h3', 'set-heading', meta.set_num + ' — ' + meta.set_name));
    }
    [1, 2, 3].forEach(function (tier) {
      var tierItems = setItems.filter(function (it) { return it.tier === tier && cardMatches(it); });
      if (!tierItems.length) return;
      shown++;
      var banner = el('h3', 'tier-banner tier-' + tier, 'TIER ' + tier + ' — ' + tierNames[String(tier)]);
      view.appendChild(banner);
      view.appendChild(el('p', 'tier-note', tierNotes[tier]));
      var grid = el('div', 'card-grid');
      tierItems.forEach(function (it) { grid.appendChild(buildCard(it)); });
      view.appendChild(grid);
    });
  });
  if (!shown) view.appendChild(el('p', 'muted', 'No pieces match these filters — try widening the type or colour.'));

  var impBtn = $('importBtn');
  if (impBtn) impBtn.hidden = selectedKeys.indexOf('8961-1') < 0;
  rebuildColourSelect();
  rebuildTypeSelect();
  renderProgress();
  renderSets(); // sidebar progress numbers
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
  if (selectedKeys.length > 1) card.appendChild(el('div', 'set-tag', 'Set ' + item.setKey));

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
  remainingBySet[item.setKey][item.id] = next;
  saveCounts(item.setKey, remainingBySet[item.setKey]);
  updateCardUI(item);
  renderProgress();
  renderSets(); // sidebar "X of 430 found" must move on the same tap
  var meta = findSet(item.setKey);
  if (meta) enqueuePartSync(meta, item);
}

function updateCardUI(item) {
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

function resetAll() {
  if (!items.length) return;
  var names = selectedKeys.join(', ');
  if (!window.confirm('Reset every lot in ' + names + ' back to its full count? Your found pieces in ' + (selectedKeys.length > 1 ? 'these sets' : 'this set') + ' will be cleared.')) return;
  selectedKeys.forEach(function (key) {
    var map = remainingBySet[key];
    var inv = getInventory(key);
    if (!map || !inv) return;
    inv.items.forEach(function (it) { map[it.id] = it.qty; });
    saveCounts(key, map);
    var meta = findSet(key);
    if (meta) enqueueBulkSync(meta);
  });
  renderSetView();
  updateSyncStatus();
}

/* ---------- Sidebar ---------- */
function setProgress(setMeta) {
  var counts = LS.get(countsKey(setMeta.set_num), null);
  var inv = getInventory(setMeta.set_num);
  if (!inv) return '0 of ' + setMeta.total_parts + ' found';
  var found = 0;
  inv.items.forEach(function (it) {
    var rem = (counts && typeof counts[it.id] === 'number') ? counts[it.id] : it.qty;
    found += (it.qty - rem);
  });
  return found + ' of ' + setMeta.total_parts + ' found';
}

function renderSets() {
  var list = $('setList');
  list.innerHTML = '';
  $('noSetsMsg').hidden = sets.length > 0;
  $('seedBtn').style.display = findSet('8961-1') ? 'none' : '';
  refreshImportButtons();
  sets.forEach(function (s) {
    var li = el('li', selectedKeys.indexOf(s.key) >= 0 ? 'active' : '');
    li.appendChild(el('div', 'set-name', s.set_name));
    li.appendChild(el('div', 'set-num', s.set_num));
    li.appendChild(el('div', 'set-progress', setProgress(s)));
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
  else if (selectedKeys.length === 1) btn.textContent = 'Sets: ' + selectedKeys[0];
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
    label.appendChild(el('span', null, s.set_num + ' — ' + s.set_name));
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
    $('addSetMsg').textContent = '';
  });
  document.querySelectorAll('.filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      statusFilter = btn.dataset.filter;
      renderSetView();
    });
  });
  $('colourSelect').addEventListener('change', function (e) {
    colourFilter = e.target.value;
    renderSetView();
  });

  $('typeSelect').addEventListener('change', function (e) {
    typeFilter = e.target.value;
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
  $('resetBtn').addEventListener('click', resetAll);
  window.addEventListener('online', function () { updateSyncStatus(); processOutbox(); });
  window.addEventListener('offline', updateSyncStatus);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) processOutbox();
  });
  setInterval(processOutbox, 20000); // retry the queue in the background
}

async function init() {
  bindEvents();
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
        await refreshSetsFromCloud();
      }
      sb.auth.onAuthStateChange(handleAuthChange);
    } catch (e) {
      console.warn('auth check failed, continuing as guest', e);
    }
  }
  // Guest path (or a set added on another device): load every set's
  // inventory from the cache table before the first open.
  await loadInventoriesForSets();
  renderAuth();
  renderSets();
  var last = LS.get('bf:activeSet', null);
  var savedSel = loadSelectedKeys();
  if (savedSel && savedSel.length && savedSel.every(function (k) { return findSet(k); })) {
    selectedKeys = savedSel;
    activeSetKey = (last && selectedKeys.indexOf(last) >= 0) ? last : selectedKeys[0];
    loadSelected();
  } else if (last && findSet(last)) openSet(last);
  else if (sets.length) openSet(sets[0].key);
  else showEmpty();
  updateSyncStatus();
}

document.addEventListener('DOMContentLoaded', init);

// @ts-check
// The demo shelf: songs in different genres, so a newcomer hears what Overdub can be. Each is a module with META
// ({ id, title, genre, line, tempo, key }) and make() -> a fresh project. The house ('overdub', drawn neutral) played
// most of each; Claude ('claude', drawn cool) played over it, and its parts make musical sense on their own.
// core/demo.js puts "Night Shift" first and exposes the whole shelf (DEMOS, demoById); tools/demos-test.js renders
// every one and holds it to its levels and its key. Turndown and Ice Machine are built on automation lanes too
// (written with the auto ops, lib.js automate): a filter that is the song, a pump, a dub mixed at the desk. Vacancy is
// a whole song in its form (intro to outro, 2:12) on Studio A, Light Table, Slide Rule and Scribble Strip. Service Lift
// (dubstep) and Boiler Room (metal) are genre demos: built wholly of ops through the store (lib.js built), mastered loud,
// and held to their genre's targets (META.targets, audio/targets.js) instead of the shelf's level.
import * as dustJacket from './dust-jacket.js';
import * as halation from './halation.js';
import * as lido from './lido.js';
import * as sodium from './sodium.js';
import * as redEye from './red-eye.js';
import * as lateCheckout from './late-checkout.js';
import * as wakeUpCall from './wake-up-call.js';
import * as lobbyBar from './lobby-bar.js';
import * as roomService from './room-service.js';
import * as turndown from './turndown.js';
import * as iceMachine from './ice-machine.js';
import * as vacancy from './vacancy.js';
import * as serviceLift from './service-lift.js';
import * as boilerRoom from './boiler-room.js';

export const MORE_DEMOS = [dustJacket, halation, lido, sodium, redEye, lateCheckout, wakeUpCall, lobbyBar, roomService, turndown, iceMachine, vacancy, serviceLift, boilerRoom].map((m) => ({ ...m.META, make: m.make }));

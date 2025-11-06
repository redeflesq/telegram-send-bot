
const { Api, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const ini = require("js-ini");
const fs = require("fs");
const process = require('process');
const readline = require('readline');
const cc = require('node-console-colors');
const crypto = require('crypto');

const app_version = '1.1';
const app_name = 'TelegramSendBot'

function question(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            return resolve(answer);
        });
    });
};

const fcolors = {
    gray: (s) => cc.set('fg_gray', s),
    white: (s) => cc.set('fg_white', s),
    dark_red: (s) => cc.set('fg_dark_red', s),
    red: (s) => cc.set('fg_red', s),
    dark_yellow: (s) => cc.set('fg_dark_yellow', s),
    yellow: (s) => cc.set('fg_yellow', s),
    dark_cyan: (s) => cc.set('fg_dark_cyan', s),
    cyan: (s) => cc.set('fg_cyan', s),
    dark_green: (s) => cc.set('fg_dark_green', s),
    green: (s) => cc.set('fg_green', s),
    dark_blue: (s) => cc.set('fg_dark_blue', s),
    blue: (s) => cc.set('fg_blue', s),
    dark_purple: (s) => cc.set('fg_dark_purple', s),
    purple: (s) => cc.set('fg_purple', s),
    default: (s) => cc.set('fg_default', s),
    rainbow: (s, start = 0) => {

        let ns = `${s}`;
        let xs = '';
        let colors = ['red', 'yellow', 'green', 'cyan', 'blue', 'purple'];
        let color_iter = 0;

        for (let i = 0; i < ns.length; i++) {
            if (ns[i] == ' ') {
                xs += ' ';
            } else {
                xs += fcolors[colors.at((start + color_iter++) % colors.length)](ns[i]);
            }
        }

        return xs;
    }
}

async function pressEnter() {
    return await question('Press <ENTER> to continue...');
}

async function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    });
}

var rainbow_iter = 0;
function clear() {
    console.clear();
    console.log(fcolors.rainbow(`${app_name} ${app_version}`, rainbow_iter--));
}

async function getAvailableDialogs(client, exclude_pinned = false, include_archive = true) {

    let dialogs = [];

    try {

        for (let j = 0; j < (include_archive ? 2 : 1); j++) {

            const result = await client.invoke(

                new Api.messages.GetDialogs({
                    offsetDate: 0,
                    offsetId: 0,
                    offsetPeer: new Api.InputPeerEmpty(),
                    limit: 1000,
                    hash: BigInt("0"),
                    excludePinned: exclude_pinned,
                    folderId: j,
                })

            );

            const chats = result.chats;
            const users = result.users;

            const archive = j == 1;

            for (const dialog of result.dialogs) {

                const peer = dialog.peer;

                let obj = null;
                let type = 'undefined';
                let id = '0';

				if (peer.userId) {

					// This is a user — search for them in the users list
					const user = users.find(u => u.id.toString() === peer.userId.toString());

					if (user && user.id && user.id != 0 && !user.deleted && !user.self) {
						type = user.bot ? 'bot' : 'user';
						id = peer.userId.toString();
						obj = user;
					}

				} else if (peer.chatId) {

					// This is a group chat — search for it in the chats list
					const chat = chats.find(c => Number(c.id) == Number(peer.chatId));

					if (chat) {
						type = 'chat';
						id = peer.chatId.toString();
						obj = chat;
					}

				} else if (peer.channelId) {

					// This is a channel — search for it in the chats list (channels are also returned in chats)
					const channel = chats.find(c => Number(c.id) == Number(peer.channelId));

					if (channel) {
						type = 'channel';
						id = peer.channelId.toString();
						obj = channel;
					}
				}

                if (id != '0' && type != 'undefined') {
                    dialogs.push({
                        id: id,
                        type: type,
                        peer: peer,
                        obj: obj,
                        archive: archive
                    });
                }

            }
        }

    } catch (e) { }

    return dialogs;
}

function getUserDisplayName(user) {

    let res = '';

    try {

        if (user.firstName) {
            res += user.firstName + (user.lastName || user.username ? ' ' : '');
        }

        if (user.lastName) {
            res += user.firstName + (user.username ? ' ' : '');;
        }

        if (user.username) {
            res += `(@${user.username})`;
        }

    } catch (e) {
        res += fcolors.red('(Error)');
    }

    return res;
};

function getDialogDisplayType(dialog) {

    switch (dialog.type) {
        case 'bot': return 'Bot';
        case 'user': return 'User';
        case 'chat': return 'Chat';
        case 'channel': return 'Channel';
        default: return 'Undefined'
    }
}

function getDialogDisplayArchive(dialog) {
    return dialog.archive ? fcolors.cyan('Archived') : '';
}

function getDialogDisplayName(dialog) {

    if (dialog.type == 'bot' || dialog.type == 'user') {
        return getUserDisplayName(dialog.obj);
    } else if (dialog.type == 'chat' || dialog.type == 'channel') {
        return dialog.obj.title;
    } else {
        return fcolors.red('Undefined dialog');
    }
}

async function getCurrentUser(client) {

    try {
        return await client.getMe();
    } catch (e) {
        return null;
    } 
}

/**
 * @param {String} number
 * @returns If telephone exists return info, otherwise return null
 */
const resolvePhone = async (client, number) => {

    let res = null;

    try {

        res = await client.invoke(
            new Api.contacts.ResolvePhone({
                phone: number,
            })
        )

    } catch (e) { }

    return res;
};

var _client = null;
var _silent_auth = false;
var _available_dialogs = [];
var _send_archive_chats = false;
var _send_pinned_chats = false;
var _send_bots = false;
var _send_users = true;
var _send_chats = true;
var _send_channels = false;

async function getTelegramDialog() {

    for (dialog of _available_dialogs) {
        if (dialog.type == 'user' && dialog.obj.firstName == 'Telegram') {
            return dialog;
        }
    }

    return null;
}

async function showDialogs() {

    await sleep(50);

    clear();

    for (dialog of _available_dialogs) {
        console.log(`${getDialogDisplayType(dialog)} ${getDialogDisplayArchive(dialog)}\t- ${getDialogDisplayName(dialog)}`);
        await sleep(5);
    }

    await pressEnter();
}

async function deleteMessage(dialog, message_id) {

    let result = null;

    for (let i = 0; result == null || result.className != 'messages.AffectedMessages'; i++) {
        result = await _client.invoke(
            new Api.messages.DeleteMessages({
                id: [message_id],
                revoke: false,
            })
        );

        if (i >= 5) break;

        await sleep(100);
    }

    if (result && result.className == 'messages.AffectedMessages') {
        return true;
    } else {
        return false;
    }
}

async function sendMessage(dialog, message) {

    try {
        const rid = Number(crypto.randomInt(Number(0xFFFFFFFF)));

        const result_updates = await _client.invoke(
            new Api.messages.SendMessage({
                peer: dialog.peer,
                message: message,
                randomId: rid,
                noWebpage: true,
                noforwards: false,
                scheduleDate: 0
            })
        );

        if (!result_updates.updates && result_updates.className && result_updates.className == 'UpdateShortSentMessage') {

			const message_id = result_updates.id;

			if (!deleteMessage(dialog, message_id)) {
				console.log(fcolors.red('Sent but not deleted!!!'));
			}

			return true;

		} else {

			const update_message_id = result_updates.updates.find((c) => c.randomId && Number(c.randomId) == rid);

			if (update_message_id) {

				const update_new_message = result_updates.updates.find((c) => c.message && Number(c.message.id) == Number(update_message_id.id))

				if (update_new_message) {

					const message_id = update_new_message.message.id;

					if (!deleteMessage(dialog, message_id)) {
						console.log(fcolors.red('Sent but not deleted!!!'));
					}

					return true;

				} else {
					throw 'Failed to find new message event';
				}

			} else {
				throw 'Failed to find message ID update event';
			}
		}

    } catch (e) {
        console.log(e);
    }

    return false;
}

async function startSend() {

    clear();

    const message = await question('Enter the message to send: ');

    if (await question(`Message '${message}'\r\nWill be sent to approximately ${_available_dialogs.length} dialogs\r\nSettings will be applied during the process\r\nContinue?\r\n(y/n): `) == 'y') {

        let index = 1;
        let max_index = _available_dialogs.length;

        for (dialog of _available_dialogs) {

            if (dialog.type == 'user' && dialog.obj.firstName == 'Telegram') {
                console.log(`[${index}/${max_index}] ${getDialogDisplayName(dialog)} skipped`);
                index++;
                continue;
            }

            if (dialog.type == 'bot' && !_send_bots) {
                console.log(`[${index}/${max_index}] ${getDialogDisplayName(dialog)} bot skipped`);
                index++;
                continue;
            }

            if (dialog.type == 'chat' && !_send_chats) {
                console.log(`[${index}/${max_index}] ${getDialogDisplayName(dialog)} chat skipped`);
                index++;
                continue;
            }

            if (dialog.type == 'channel' && !_send_channels) {
                console.log(`[${index}/${max_index}] ${getDialogDisplayName(dialog)} channel skipped`);
                index++;
                continue;
            }

            if (dialog.type == 'user' && !_send_users) {
                console.log(`[${index}/${max_index}] ${getDialogDisplayName(dialog)} user skipped`);
                index++;
                continue;
            }

            let res = await sendMessage(dialog, message);

            console.log(`[${index}/${max_index}] ${getDialogDisplayName(dialog)} ` + (res ? 'sent' : 'not sent'));

            await sleep(150);
            index++;
        }

        await sleep(100);
        await pressEnter();
    };
}

(async () => {

    if (!fs.existsSync('settings.ini')) {
        fs.writeFileSync('settings.ini', '[main]\r\napi_id=\r\napi_hash=\r\nsession=session.txt\r\n');
    }

    const settings = ini.parse(fs.readFileSync('settings.ini').toString());

    if (!settings || !settings.main || !settings.main.api_id || !settings.main.api_hash) {
        console.log('Specify api_id and api_hash in the settings!');
        await pressEnter();
        process.exit(0);
    }

    let session_path = 'session.txt';

    if (settings.main.session) {
        session_path = settings.main.session;
    }

    let session_exists = false;
    let session_txt = "";

    if (fs.existsSync(session_path)) {
        session_txt = fs.readFileSync(session_path).toString();
        session_exists = true;
    }

    const api_id = Number(settings.main.api_id);
    const api_hash = String(settings.main.api_hash);

    const string_session = new StringSession(session_txt);

    const client = new TelegramClient(string_session, api_id, api_hash, {
        connectionRetries: 2
    });

    console.clear();

    await (async () => {
		
		console.log('Application that allows mass messaging to all Telegram dialogs.');

        if (!session_exists) {
            _silent_auth =
                await question(`Clear the dialog with Telegram after login?\r\ny/n: `) == 'y' ? true : false;
        }

        const log_level = (() => {
            try {
                return String(settings.debug.log_level);
            } catch (e) {
                return 'error';
            }
        })();

        client.setLogLevel(log_level);

        await client.start({
            phoneNumber: async () => question("Phone number: "),
            password: async () => question("Password: "),
            phoneCode: async () => question("Code: "),
            onError: (err) => console.log(err.errorMessage),
        });

        // Save session
        fs.writeFileSync(session_path, client.session.save());

        _client = client;
        _available_dialogs = await getAvailableDialogs(client, !_send_pinned_chats, _send_archive_chats);

        if (_silent_auth) {

            console.log('Clearing Telegram dialog...');

            try {

                let tdlg = await getTelegramDialog();

                await client.invoke(
                    new Api.messages.DeleteHistory({
                        peer: tdlg.peer,
                        maxId: 0,
                        justClear: true,
                        revoke: false,
                        minDate: 0,
                        maxDate: 0,
                    })
                );

            } catch (e) {
                console.log(fcolors.red('Failed :('));
                console.log(e);
                await pressEnter();
            }

            await sleep(250);
        }

    })().catch(async (reason) => {

        console.log(fcolors.red('Failed to load Telegram...'));
        console.log(fcolors.red('Reason:'));
        console.log(reason);
        await pressEnter();
        process.exit(0);

    }).then(async () => {

        let exit = false;

        const user_display_name = await getUserDisplayName(await getCurrentUser(client));

        while (!exit) {

            clear();
	
            console.log(`Authorized as ${user_display_name}...`);
            console.log(`Found available dialogs: ${_available_dialogs.length}`);

            console.log(
                '1. Refresh dialogs \n' +
                '2. View dialogs \n' +
                `3. Send to archived dialogs (${fcolors.cyan(_send_archive_chats ? 'yes' : 'no')}) \n` +
                `4. Send to pinned dialogs (${fcolors.cyan(_send_pinned_chats ? 'yes' : 'no')}) \n` +
                `5. Send to bots (${fcolors.cyan(_send_bots ? 'yes' : 'no')}) \n` +
                `6. Send to users (${fcolors.cyan(_send_users ? 'yes' : 'no')}) \n` +
                `7. Send to group chats (${fcolors.cyan(_send_chats ? 'yes' : 'no')}) \n` +
                `8. Send to channels (${fcolors.cyan(_send_channels ? 'yes' : 'no')}) \n` +
                '9. Start sending \n' +
                'Q. Exit \n' +
                'X. Log out of session'
            );

            console.log('\nImportant! After changing settings (3 & 4), be sure to refresh dialogs.\n')

            const action = await question('Enter the action number: ');

            try {
                switch (action) {
                    case '1':
                        _available_dialogs = await getAvailableDialogs(client, !_send_pinned_chats, _send_archive_chats);
                        break;
                    case '2':
                        await showDialogs();
                        break;
                    case '3':
                        _send_archive_chats = !_send_archive_chats;
                        break;
                    case '4':
                        _send_pinned_chats = !_send_pinned_chats;
                        break;
                    case '5':
                        _send_bots = !_send_bots;
                        break;
                    case '6':
                        _send_users = !_send_users;
                        break;
                    case '7':
                        _send_chats = !_send_chats;
                        break;
                    case '8':
                        _send_channels = !_send_channels;
                        break;
                    case '9':
                        await startSend();
                        break;
                    case 'X':
                    case 'x':
                        const result = await client.invoke(new Api.auth.LogOut({}));
                        console.log(result);
                        fs.unlinkSync(session_path);
                        await pressEnter();
                    case 'Q':
                    case 'q':
                        exit = true;
                        process.exit(0);
                        break;
                }

            } catch (e) {
                console.error(fcolors.red(e));
                await pressEnter();
            }
        }
    });


})().catch((e) => {
    console.log(e);
    while (true);
});

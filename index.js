const Discord = require('discord.js'); // https://discord.js.org/#/docs/main/stable/general/welcome
const fs = require('fs');
const Markov = require('markov-strings');
const schedule = require('node-schedule');

const client = new Discord.Client();
// const ZEROWIDTH_SPACE = String.fromCharCode(parseInt('200B', 16));
// const MAXMESSAGELENGTH = 2000;

const PAGE_SIZE = 100;
// let guilds = [];
// let connected = -1;
let GAME = 'GAME';
let PREFIX = '! ';
const inviteCmd = 'invite';
const errors = [];

let fileObj = {
  messages: [],
};

let markovDB = [];
let messageCache = [];
let deletionCache = [];
const markovOpts = {
  stateSize: 2,
  maxLength: 2000,
  minWords: 3,
  maxWords: 0,
  minScore: 10,
  minScorePerWord: 0,
  maxTries: 10000,
};
let markov;
// let markov = new Markov(markovDB, markovOpts);

function uniqueBy(arr, propertyName) {
  const unique = [];
  const found = {};

  for (let i = 0; i < arr.length; i++) {
    const value = arr[i][propertyName];
    if (!found[value]) {
      found[value] = true;
      unique.push(arr[i]);
    }
  }
  return unique;
}

/**
 * Regenerates the corpus and saves all cached changes to disk
 */
function regenMarkov() {
  console.log('Regenerating Markov corpus...');
  try {
    fileObj = JSON.parse(fs.readFileSync('markovDB.json', 'utf8'));
  } catch (err) {
    console.log(err);
  }
  // console.log("MessageCache", messageCache)
  markovDB = fileObj.messages;
  markovDB = uniqueBy(markovDB.concat(messageCache), 'id');
  deletionCache.forEach((id) => {
    const removeIndex = markovDB.map(item => item.id).indexOf(id);
    // console.log('Remove Index:', removeIndex)
    markovDB.splice(removeIndex, 1);
  });
  deletionCache = [];
  if (markovDB.length === 0) {
    markovDB.push({ string: 'hello', id: null });
  }
  markov = new Markov(markovDB, markovOpts);
  markov.buildCorpusSync();
  fileObj.messages = markovDB;
  // console.log("WRITING THE FOLLOWING DATA:")
  // console.log(fileObj)
  fs.writeFileSync('markovDB.json', JSON.stringify(fileObj), 'utf-8');
  fileObj = null;
  messageCache = [];
  console.log('Done regenerating Markov corpus.');
}

/**
 * Loads the config settings from disk
 */
function loadConfig() {
  const cfgfile = 'config.json';
  if (fs.existsSync(cfgfile)) {
    const cfg = JSON.parse(fs.readFileSync(cfgfile, 'utf8'));
    PREFIX = cfg.prefix;
    GAME = cfg.game;
    // regenMarkov()
    client.login(cfg.token);
  } else {
    console.log(`Oh no!!! ${cfgfile} could not be found!`);
  }
}

/**
 * Reads a new message and checks if and which command it is.
 * @param {Message} message Message to be interpreted as a command
 * @return {String} Command string
 */
function validateMessage(message) {
  const messageText = message.content.toLowerCase();
  let command = null;
  const thisPrefix = messageText.substring(0, PREFIX.length);
  if (thisPrefix === PREFIX) {
    const split = messageText.split(' ');
    if (split[0] === PREFIX && split.length === 1) {
      command = 'respond';
    } else if (split[1] === 'train') {
      command = 'train';
    } else if (split[1] === 'help') {
      command = 'help';
    } else if (split[1] === 'regen') {
      command = 'regen';
    } else if (split[1] === 'invite') {
      command = 'invite';
    } else if (split[1] === 'debug') {
      command = 'debug';
    }
  }
  return command;
}

/**
 * Function to recursively get all messages in a text channel's history. Ends
 * by regnerating the corpus.
 * @param {Message} message Message initiating the command, used for getting
 * channel data
 */
async function fetchMessages(message) {
  let historyCache = [];
  let keepGoing = true;
  let oldestMessageID = null;

  while (keepGoing) {
    // eslint-disable-next-line no-await-in-loop
    const messages = await message.channel.fetchMessages({
      before: oldestMessageID,
      limit: PAGE_SIZE,
    });
    const nonBotMessageFormatted = messages
      .filter(elem => !elem.author.bot).map((elem) => {
        const dbObj = {
          string: elem.content,
          id: elem.id,
        };
        if (elem.attachments.size > 0) {
          dbObj.attachment = elem.attachments.values().next().value.url;
        }
        return dbObj;
      });
    historyCache = historyCache.concat(nonBotMessageFormatted);
    oldestMessageID = messages.last().id;
    if (messages.size < PAGE_SIZE) {
      keepGoing = false;
    }
  }
  console.log(`Trained from ${historyCache.length} past human authored messages.`);
  messageCache = messageCache.concat(historyCache);
  regenMarkov();
  message.reply(`Finished training from past ${historyCache.length} messages.`);
}


/**
 * General Markov-chain response function
 * @param {Message} message The message that invoked the action, used for channel info.
 * @param {Boolean} debug Sends debug info as a message if true.
 */
function generateResponse(message, debug = false) {
  console.log('Responding...');
  markov.generateSentence().then((result) => {
    console.log('Generated Result:', result);
    const messageOpts = { tts: message.tts };
    const randomMessage = markovDB[Math.floor(Math.random() * markovDB.length)];
    console.log('Random Message:', randomMessage);
    if (Object.prototype.hasOwnProperty.call(randomMessage, 'attachment')) {
      messageOpts.files = [{ attachment: randomMessage.attachment }];
    }
    message.channel.send(result.string, messageOpts);
    if (debug) message.channel.send(`\`\`\`\n${JSON.stringify(result, null, 2)}\n\`\`\``);
  }).catch((err) => {
    console.log(err);
    if (debug) message.channel.send(`\n\`\`\`\nERROR${err}\n\`\`\``);
    if (err.message.includes('Cannot build sentence with current corpus')) {
      console.log('Not enough chat data for a response.');
    }
  });
}


client.on('ready', () => {
  console.log('Markbot by Charlie Laabs');
  client.user.setActivity(GAME);
});

client.on('error', (err) => {
  const errText = `ERROR: ${err.name} - ${err.message}`;
  console.log(errText);
  errors.push(errText);
  fs.writeFile('error.json', JSON.stringify(errors), (fsErr) => {
    if (fsErr) {
      console.log(`error writing to error file: ${fsErr.message}`);
    }
  });
});

client.on('message', (message) => {
  if (message.guild) {
    const command = validateMessage(message);
    if (command === 'help') {
      console.log(message.channel);
      const richem = new Discord.RichEmbed()
        .setAuthor(client.user.username, client.user.avatarURL)
        .setThumbnail(client.user.avatarURL)
        .setDescription('A Markov chain chatbot that speaks based on previous chat input.')
        .addField('!mark', 'Generates a sentence to say based on the chat database. Send your '
        + 'message as TTS to recieve it as TTS.')
        .addField('!mark train', 'Fetches the maximum amount of previous messages in the current '
        + 'text channel, adds it to the database, and regenerates the corpus. Takes some time.')
        .addField('!mark regen', 'Manually regenerates the corpus to add recent chat info. Run '
        + 'this before shutting down to avoid any data loss. This automatically runs at midnight.')
        .addField('!mark invite', 'Don\'t invite this bot to other servers. The database is shared '
        + 'between all servers and text channels.')
        .addBlankField('!mark debug', 'Runs the !mark command and follows it up with debug info.');
      message.channel.send(richem).catch(() => {
        message.author.send(richem);
      });
    }
    if (command === 'train') {
      console.log('Training...');
      fileObj = {
        messages: [],
      };
      fs.writeFileSync('markovDB.json', JSON.stringify(fileObj), 'utf-8');
      fetchMessages(message);
    }
    if (command === 'respond') {
      generateResponse(message);
    }
    if (command === 'debug') {
      generateResponse(message, true);
    }
    if (command === 'regen') {
      console.log('Regenerating...');
      regenMarkov();
    }
    if (command === null) {
      console.log('Listening...');
      if (!message.author.bot) {
        const dbObj = {
          string: message.content,
          id: message.id,
        };
        if (message.attachments.size > 0) {
          dbObj.attachment = message.attachments.values().next().value.url;
        }
        messageCache.push(dbObj);
      }
    }
    if (command === inviteCmd) {
      const richem = new Discord.RichEmbed()
        .setAuthor(`Invite ${client.user.username}`, client.user.avatarURL)
        .setThumbnail(client.user.avatarURL)
        .addField('Invite', `[Invite ${client.user.username} to your server](https://discordapp.com/oauth2/authorize?client_id=${client.user.id}&scope=bot)`);

      message.channel.send(richem)
        .catch(() => {
          message.author.send(richem);
        });
    }
  }
});

client.on('messageDelete', (message) => {
  // console.log('Adding message ' + message.id + ' to deletion cache.')
  deletionCache.push(message.id);
  console.log('deletionCache:', deletionCache);
});

loadConfig();
schedule.scheduleJob('0 0 * * *', regenMarkov());

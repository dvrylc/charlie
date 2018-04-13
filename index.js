// [CONFIG] Google Cloud imports
const recorder = require('./recorder.js');
const speech = require('@google-cloud/speech');
const fs = require('fs');
const textToSpeech = require('@google-cloud/text-to-speech');

// [CONFIG] App imports
const fetch = require('node-fetch');
const player = require('play-sound')(opts = {});
const ping = require('ping');

// [CONFIG] Instantiate new clients
const speechClient = new speech.SpeechClient();
const ttsClient = new textToSpeech.TextToSpeechClient();

// [CONFIG] Global configuration objects
const recordingConfig = {
  encoding: 'FLAC',
  sampleRateHertz: 16000,
  languageCode: 'en-US'
}
const appConfig = {
  delay: 2000,
  key: Buffer.from('JDJhJDEwJGkxaHR0STZUSWZVMXptcDZuQ3FaUnVYalFzYlQ1VmRscW1aZTRlczV2MU44VFhubWxRYXFL', 'base64').toString('ascii'),
  isListening: false,
  isRecording: false,
  recognitionStream: null
}
let appData = {};

// [INPUT]
// Checks if there is an active recording session
// - If there is, kill the active session and reset vars
// Start recording and pipe the input for recognition
const startRecording = () => {
  if (appConfig.isRecording) {
    util.cleanup();
  }

  startRecognitionStream();

  recorder.start({
    sampleRateHertz: recordingConfig.sampleRateHertz,
    threshold: 0,
    verbose: false,
    recordProgram: 'rec',
    silence: '10.0'
  })
  .on('error', console.error)
  .pipe(appConfig.recognitionStream);

  appConfig.isRecording = true;
}

// [INPUT]
// Starts the audio recognition stream at `appConfig.recognitionStream`
const startRecognitionStream = () => {
  const streamConfig = {
    config: {
      encoding: recordingConfig.encoding,
      sampleRateHertz: recordingConfig.sampleRateHertz,
      languageCode: recordingConfig.languageCode
    },
    interimResults: false
  };

  // todo: move data parsing out
  appConfig.recognitionStream = speechClient.streamingRecognize(streamConfig)
    .on('error', console.error)
    .on('data', processRecognition);
}

// [INPUT]
// Process data from recognition
const processRecognition = data => {
  // Check that data contains valid inpus
  if (data.results[0] && data.results[0].alternatives[0]) {
    // Parse data
    const input = data.results[0].alternatives[0].transcript.trim().toLowerCase();

    // Hotword detection
    if (/(exit|restart)/i.test(input)) {
      util.log('INFO', 'APP', `Heard ${input}, cleaning up`);
      util.cleanup(true, 0);
    }
    if (/(hello|hey|hi) charlie/i.test(input)) {
      util.log('INFO', 'MIC', `Heard ${input}, started active listening`);
      tts(`Hello ${appData.name}`);
      return;
    }
    if (/(goodbye) charlie/i.test(input)) {
      util.log('INFO', 'MIC', `Heard ${input}, stopped active listening`);
      util.mic.off();
      tts(`Goodbye ${appData.name}`, false);
      return;
    }

    // Process question
    if (appConfig.isListening) {
      util.log('INFO', 'MIC', `Heard - ${input}`);
      util.mic.off();
      app(input);
    }
  }
}

// [OUTPUT]
// Takes input text and calls for TTS
// Once audio is returned, write it to a file
// Play the file, then turn on the mic
const tts = (text, onMic = true) => {
  util.log('INFO', 'TTS', `Speaking - ${text}`);

  const ttsConfig = {
    input: {
      text: text
    },
    voice: {
      languageCode: 'en-US',
      name: 'en-US-Wavenet-A'
    },
    audioConfig: {
      audioEncoding: 'MP3',
      pitch: 4.5
    },
  };

  // Call for TTS
  ttsClient.synthesizeSpeech(ttsConfig, (err, res) => {
    if (err) {
      util.log('ERROR', 'TTS', err);
      return;
    }

    const outputFile = `${__dirname}/output.mp3`;

    // Write the audio content to file
    fs.writeFile(outputFile, res.audioContent, 'binary', err => {
      if (err) {
        util.log('ERROR', 'TTS', err);
        return;
      }

      // Play file then resume listening
      player.play(outputFile, err => {
        if (err) {
          util.log('ERROR', 'TTS', err);
          return;
        }

        util.log('INFO', 'TTS', 'Done');

        if (onMic) {
          setTimeout(() => {
            util.mic.on();
            util.ding();
          }, appConfig.delay);
        }
      });
    });
  });
}

// [UTIL]
// Logging, mic toggles, ding player, cleanup
const util = {
  log: (level, source, message) => {
    console.log(`${new Date().toLocaleString()}\t[${level} - ${source}]\t${message}`);
  },
  mic: {
    on: () => {
      appConfig.isListening = true;
      util.log('INFO', 'MIC', 'Listening on');
    },
    off: () => {
      appConfig.isListening = false;
      util.log('INFO', 'MIC', 'Listening off');
    }
  },
  ding: () => {
    player.play(`${__dirname}/ding.mp3`, err => {
      if (err) {
        util.log('ERROR', 'TTS', err);
        return;
      }
    });
  },
  cleanup: (exit = false, exitCode = 0) => {
    util.log('INFO', 'APP', 'Found active recording session, killing');
    appConfig.recognitionStream = null;
    recorder.stop();
    appConfig.isRecording = false;

    if (exit) {
      util.log('INFO', 'APP', 'Cleanup complete, exiting');
      process.exit(exitCode);
    }
  },
  fetch: () => {
    fetch('https://api.jsonbin.io/b/5acc18df34fe482b8aca7f66/latest', {
      headers: {
        'secret-key': appConfig.key
      }
    })
      .then(r => r.json())
      .then(r => {
        appData = r;
        util.log('INFO', 'APP', `Data updated - ${r.name}, book 1: ${r.books[0].isActivated}, book 2: ${r.books[1].isActivated}`);
      })
      .catch(err => {
        util.log('ERROR', 'APP', err);
      });
  }

}
// [APP] Main logic
const app = question => {
  util.log('INFO', 'APP', `Processing - ${question}`);

  let answerFound = false;

  // Enable activated questions
  let data = [];
  appData.books.forEach(book => {
    if (book.isActivated) {
      data = data.concat(book.questions);
    }
  });

  // Iterate through all questions for a match
  for (let i = 0; i < data.length; i++) {
    const pair = data[i];
    const regexp = new RegExp(pair.q, 'i');

    if (regexp.test(question)) {
      util.log('INFO', 'APP', `Found answer - ${pair.a}`);
      answerFound = true;
      tts(pair.a);
      break;
    }
  }

  if (!answerFound) {
    util.log('INFO', 'APP', 'Unknown question')
    tts('Sorry, I don\'t know the answer to that. Try asking your parents.');
  }
}

// [APP]
// Ping Google servers for latency to determine delay duration
// Start recording and set restart interval to 45s
ping.promise.probe('35.186.221.153', { min_reply: 4 })
  .then(res => {
    if (res.avg >= 140) {
      appConfig.delay = Math.min(res.avg * 15, 4500);
    }

    util.log('INFO', 'APP', 'Started');
    util.log('INFO', 'APP', `Ping: ${res.avg}ms, delay set to ${appConfig.delay}ms`);
    util.ding();

    util.fetch();
    setInterval(util.fetch, 15000);

    startRecording();
    setInterval(startRecording, 45000);
  })
  .catch(err => {
    util.log('ERROR', 'APP', err);
    util.cleanup(true, 1);
  });

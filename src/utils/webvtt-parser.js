import VTTParser from './vttparser';

const utf8ArrayToStr = function(array) {
  const len = array.length;
  let c;
  let char2;
  let char3;
  let out = '';
  let i = 0;
  while (i < len) {
    c = array[i++];
    // If the character is 3 (END_OF_TEXT) or 0 (NULL) then skip it
    if (c === 0x00 || c === 0x03) {
      continue;
    }
    switch (c >> 4) {
      case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
      // 0xxxxxxx
      out += String.fromCharCode(c);
      break;
      case 12: case 13:
      // 110x xxxx   10xx xxxx
      char2 = array[i++];
      out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
      break;
      case 14:
        // 1110 xxxx  10xx xxxx  10xx xxxx
        char2 = array[i++];
        char3 = array[i++];
        out += String.fromCharCode(((c & 0x0F) << 12) |
          ((char2 & 0x3F) << 6) |
          ((char3 & 0x3F) << 0));
        break;
      default:
    }
  }
  return out;
};

// String.prototype.startsWith is not supported in IE11
const startsWith = function(inputString, searchString, position) {
  return inputString.substr(position || 0, searchString.length) === searchString;
};

const cueString2millis = function(timeString) {
    let ts = parseInt(timeString.substr(-3));
    let secs = parseInt(timeString.substr(-6,2));
    let mins = parseInt(timeString.substr(-9,2));
    let hours = timeString.length > 9 ? parseInt(timeString.substr(0, timeString.indexOf(':'))) : 0;

    if (isNaN(ts) || isNaN(secs) || isNaN(mins) || isNaN(hours)) {
        return -1;
    }

    ts += 1000 * secs;
    ts += 60*1000 * mins;
    ts += 60*60*1000 * hours;

    return ts;
};

const calculateOffset = function(vttCCs, cc, presentationTime) {
    let currCC = vttCCs[cc];
    let prevCC = vttCCs[currCC.prevCC];

    // This is the first discontinuity or cues have been processed since the last discontinuity
    // Offset = current discontinuity time
    if (!prevCC || (!prevCC.new && currCC.new)) {
        vttCCs.ccOffset = vttCCs.presentationOffset = currCC.start;
        currCC.new = false;
        return;
    }

    // There have been discontinuities since cues were last parsed.
    // Offset = time elapsed
    while (prevCC && prevCC.new) {
        vttCCs.ccOffset += currCC.start - prevCC.start;
        currCC.new = false;
        currCC = prevCC;
        prevCC = vttCCs[currCC.prevCC];
    }

    vttCCs.presentationOffset = presentationTime;
};

const WebVTTParser = {
    parse: function(vttByteArray, syncPTS, vttCCs, cc, callBack, errorCallBack) {
        // Convert byteArray into string, replacing any somewhat exotic linefeeds with "\n", then split on that character.
        let re = /\r\n|\n\r|\n|\r/g;
        let vttLines = utf8ArrayToStr(new Uint8Array(vttByteArray)).trim().replace(re, '\n').split('\n');
        let cueTime = '00:00.000';
        let mpegTs = 0;
        let localTime = 0;
        let presentationTime = 0;
        let cues = [];
        let parsingError;
        let inHeader = true;
        // let VTTCue = VTTCue || window.TextTrackCue;

        // Create parser object using VTTCue with TextTrackCue fallback on certain browsers.
        let parser = new VTTParser();

        parser.oncue = function(cue) {
            // Adjust cue timing; clamp cues to start no earlier than - and drop cues that don't end after - 0 on timeline.
            let currCC = vttCCs[cc];
            let cueOffset = vttCCs.ccOffset;

            // Update offsets for new discontinuities
            if (currCC && currCC.new) {
                if (localTime) {
                    // When local time is provided, offset = discontinuity start time - local time
                    cueOffset = vttCCs.ccOffset = currCC.start;
                } else {
                    calculateOffset(vttCCs, cc, presentationTime);
                }
            }

            if (presentationTime && !localTime) {
                // If we have MPEGTS but no LOCAL time, offset = presentation time + discontinuity offset
                cueOffset = presentationTime + vttCCs.ccOffset - vttCCs.presentationOffset;
            }

            cue.startTime += cueOffset - localTime;
            cue.endTime += cueOffset - localTime;

            // Fix encoding of special characters. TODO: Test with all sorts of weird characters.
            cue.text = decodeURIComponent(encodeURIComponent(cue.text));
            if (cue.endTime > 0) {
              cues.push(cue);
            }
        };

        parser.onparsingerror = function(e) {
            parsingError = e;
        };

        parser.onflush = function() {
            if (parsingError && errorCallBack) {
                errorCallBack(parsingError);
                return;
            }
            callBack(cues);
        };

        // Go through contents line by line.
        vttLines.forEach(line => {
            if (inHeader) {
                // Look for X-TIMESTAMP-MAP in header.
                if (startsWith(line, 'X-TIMESTAMP-MAP=')) {
                    // Once found, no more are allowed anyway, so stop searching.
                    inHeader = false;
                    // Extract LOCAL and MPEGTS.
                    line.substr(16).split(',').forEach(timestamp => {
                        if (startsWith(timestamp, 'LOCAL:')) {
                          cueTime = timestamp.substr(6);
                        } else if (startsWith(timestamp, 'MPEGTS:')) {
                          mpegTs = parseInt(timestamp.substr(7));
                        }
                    });
                    try {
                        // Calculate subtitle offset in milliseconds.
                        // If sync PTS is less than zero, we have a 33-bit wraparound, which is fixed by adding 2^33 = 8589934592.
                        syncPTS = syncPTS < 0 ? syncPTS + 8589934592 : syncPTS;
                        // Adjust MPEGTS by sync PTS.
                        mpegTs -= syncPTS;
                        // Convert cue time to seconds
                        localTime = cueString2millis(cueTime) / 1000;
                        // Convert MPEGTS to seconds from 90kHz.
                        presentationTime = mpegTs / 90000;

                        if (localTime === -1) {
                            parsingError = new Error(`Malformed X-TIMESTAMP-MAP: ${line}`);
                        }
                    }
                    catch(e) {
                        parsingError = new Error(`Malformed X-TIMESTAMP-MAP: ${line}`);
                    }
                    // Return without parsing X-TIMESTAMP-MAP line.
                    return;
                } else if (line === '') {
                  inHeader = false;
                }
            }
            // Parse line by default.
            parser.parse(line+'\n');
        });

        parser.flush();
    }
};


module.exports = WebVTTParser;

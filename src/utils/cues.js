import { fixLineBreaks } from './vttparser';

const Cues = {

  newCue: function(track, startTime, endTime, captionScreen) {
    var row;
    var line;
    var cue;
    var indenting = true;
    var indent = 0;
    var text = captionScreen.getDisplayText();
    var VTTCue = window.VTTCue || window.TextTrackCue;

    for (var r=0; r<captionScreen.rows.length; r++)
    {
      row = captionScreen.rows[r];

      if (!row.isEmpty())
      {
        for (var c=0; c<row.chars.length; c++)
        {
          if (row.chars[c].uchar.match(/\s/) && indenting)
          {
            indent++;
          }
          else
          {
            indenting = false;
          }
        }

        if (indent >= 16)
        {
          indent--;
        }
        else
        {
          indent++;
        }

        // VTTCue.line get's flakey when using controls, so let's now include line 13&14
        // also, drop line 1 since it's to close to the top
        if (navigator.userAgent.match(/Firefox\//))
        {
          line = r + 1;
        }
        else
        {
          line = (r > 7 ? r - 2 : r + 1);
        }
        break;
      }
    }

    cue = new VTTCue(startTime, endTime, fixLineBreaks(text.trim()));
    cue.align = 'left';
    cue.line = line;
    // Clamp the position between 0 and 100 - if out of these bounds, Firefox throws an exception and captions break
    cue.position = Math.max(0, Math.min(100, 100 * (indent / 32) + (navigator.userAgent.match(/Firefox\//) ? 50 : 0)));
    track.addCue(cue);
  }

};

module.exports = Cues;

import TSDemuxer from '../../src/demux/tsdemuxer';

const mediaBuffer = require('arraybuffer-loader!../assets/bbb-480p-chunk.media');
const data = new Uint8Array(mediaBuffer);

describe.only('Progressive TSDemuxer integration tests', function () {

  describe('Progressive demuxing equals non-progressive demuxing', function () {
    const demuxer= new TSDemuxer({}, {}, {});
    demuxer.resetInitSegment();
    demuxer.resetTimeStamp();
    const demuxResult = demuxer.demux(data, 0, true, false);
    console.log(demuxResult);
  });
});

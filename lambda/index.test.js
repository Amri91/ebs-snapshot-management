process.env.AWS_REGION = 'us-east-1'
process.env.ENDPOINT = 'http://localhost:4566'
process.env.RETENTION_PERIOD = '10'
process.env.TAG_NAME = 'mytag'
process.env.TAG_VALUE = 'mytagvalue'

const Docker = require ('dockerode')
const { statically, retry } = require ('fluture-retry');
const { run, EC2, listOwnSnapshots, markNonStandardSnapshots, deleteExpiredSnapshots, tracked, TRACKING_TAG, S, F, tagUntrackedVolumes } = require ('./')

jest.setTimeout(10000)

// Docker
const CONTAINER_NAME = 'my-localstack'
const docker = Docker ()
const restart = F.node (cb => docker.getContainer (CONTAINER_NAME).restart ({ t: 0 }, cb))
const wait = retry (statically (2000)) (10) (
  F.node (cb => docker.getContainer(CONTAINER_NAME).logs ({tail: 2, stdout: true},(err, data) => {
    if (err || !data) cb ({})
    const result = data.toString ()
    result.includes ('Ready.') ? cb (null, result) : cb (`Container is not ready, last log: ${result}`)
  }))
)
const teardown = restart.pipe (S.chain (_ => wait))

// AWS helpers
const createVolume = AvailabilityZone => F.node (cb => EC2.createVolume ({ AvailabilityZone, Size:1 }, cb))
const createSnapshot = VolumeId => F.node (cb => EC2.createSnapshot ({ VolumeId }, cb))
const setup = S.pipe ([createVolume, S.map (S.prop ('VolumeId')), S.chain (createSnapshot)])

// Test utilities
const promisify = future => new Promise ((resolve, reject) => F.fork (reject) (resolve) (future))

describe ('integration tests', () => {
  beforeEach(async () => await promisify (teardown))
  describe ('#listOwnSnapshots', () => {
    it ('does not list Amazon created Snapshots.', async () => {
      const results = await promisify (listOwnSnapshots ([]))

      expect ([]).toHaveLength (0)
    })
    it ('lists any customer created ebs snapshots.', async () => {
      const snapshots = await promisify (setup ('us-east-1a').pipe (S.chain (_ => listOwnSnapshots([]))))

      expect (snapshots).toHaveLength (1)
    })
  })
  describe ('#markNonStandardSnapshots', () => {
    it ('marks non standard snapshots', async () => {
      const now = '2021-03-15T12:52:52.804Z'
      const later = '2021-03-25T12:52:52.804Z'
      const snapshots = await promisify (
        setup ('us-east-1a')
          .pipe (S.chain (_ => markNonStandardSnapshots(new Date (now))))
          .pipe (S.chain (_ => listOwnSnapshots([])))
      )

      expect (snapshots).toHaveLength (1)
      expect (snapshots[0].Tags[0].Key).toBe ('DELETE_ON')
      expect (snapshots[0].Tags[0].Value).toBe (later)
    })
  })
  describe ('#deleteExpiredSnapshots', () => {
    it ('deletes expired snapshots', async () => {
      const now = '2021-03-15T12:52:52.804Z'
      const later = '2021-03-26T12:52:52.804Z'
      const snapshots = await promisify (
        setup ('us-east-1a')
          .pipe (S.chain (_ => markNonStandardSnapshots (new Date (now))))
          .pipe (S.chain (_ => deleteExpiredSnapshots (new Date (later))))
          .pipe (S.chain (_ => listOwnSnapshots([])))
      )

      expect (snapshots).toHaveLength (0)
    })
    it ('does not delete non expired snapshots', async () => {
      const now = '2021-03-15T12:52:52.804Z'
      const later = '2021-03-25T12:52:52.804Z'
      const snapshots = await promisify (
        setup ('us-east-1a')
          .pipe (S.chain (_ => markNonStandardSnapshots (new Date (now))))
          .pipe (S.chain (_ => deleteExpiredSnapshots (new Date (later))))
          .pipe (S.chain (_ => listOwnSnapshots([])))
      )

      expect (snapshots).toHaveLength (1)
    })
  })
  describe ('#tagUntrackedVolumes', () => {
    it ('tags untracked volumes', async () => {
      const volumeTags = await promisify (setup ('us-east-1a')
        .pipe (S.chain (_ => tagUntrackedVolumes))
        .pipe (S.chain (_ => listOwnSnapshots ([])))
        .pipe (S.map (S.props (['0', 'VolumeId'])))
        .pipe (S.chain (volumeId => F.node (cb => EC2.describeVolumes ({
          VolumeIds: [volumeId]
        }, cb))))
        .pipe (S.map (S.props (['Volumes', '0', 'Tags'])))
      )

      expect (volumeTags[0].Key).toBe (process.env.TAG_NAME)
      expect (volumeTags[0].Value).toBe (process.env.TAG_VALUE)
    })
  })
})

describe ('unit test', () => {
  describe ('#tracked', () => {
    it ('returns true IFF the tracking tag exist', () => {
      expect (tracked ({Tags: [TRACKING_TAG]})).toBe (true)
      expect (tracked ({Tags: []})).toBe (false)
    })
  })
  describe ('#run', () => {
    it ('runs all futures', cb => {
      run ([F.reject ('failed'), F.resolve ('succeeded')]) ((err, result) => {
        expect (err).toBeFalsy ()
        expect (result).toHaveLength (2)
        cb ()
      })
    })
  })
})
// @ts-check
import { downloadImage, resize, fit, identify } from '../lib/image';
import mime from 'mime-types';
import URL from 'url';

const ACTIONS = ['crop', 'fit', 'resize', 'identify'];
const ONE_YEAR = 31557600000;

const asyncMiddleware = fn =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next))
      .catch(next);
  };

export default ({ config, db }) => asyncMiddleware(async (req, res, body) => {

  if (!(req.method == 'GET')) {
    res.set('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  let urlParts = req.url.split('/');
  const width = parseInt(urlParts[1]);
  const height = parseInt(urlParts[2]);
  const action = urlParts[3];

  if (urlParts.length < 4 || isNaN(width) || isNaN(height) || !ACTIONS.includes(action)) {
    return res.status(400).send({
      code: 400,
      result: 'Please provide following parameters: /img/<width>/<height>/<action:crop,fit,resize,identify>/<relative_url>'
    })
  }

  if (width > config.imageable.imageSizeLimit || width < 0 || height > config.imageable.imageSizeLimit || height < 0) {
    return res.status(400).send({
      code: 400,
      result: `Width and height must have a value between 0 and ${config.imageable.imageSizeLimit}`
    })
  }

  const imgUrl = `${config[config.platform].imgUrl}/${urlParts.slice(4).join('/')}`; // full original image url

  if (!isImageSourceHostAllowed(imgUrl, config.imageable.whitelist)) {
    return res.status(400).send({
      code: 400,
      result: `Host is not allowed`
    })
  }

  console.log(`[URL]: ${imgUrl} - [ACTION]: ${action} - [WIDTH]: ${width} - [HEIGHT]: ${height}`);
  
  req.query = {
    size: width + 'x' + height,
    url: imgUrl
  }
  req.originalUrl = `/${action}?url=${encodeURIComponent(imgUrl)}&size=${width}x${height}`;
  req.url = req.originalUrl;
  req.socket.setMaxListeners(config.imageable.maxListeners || 50);

  let buffer;
  try {
    buffer = await downloadImage(imgUrl);
  } catch (err) {
    return res.status(400).send({
      code: 400,
      result: `Unable to download the requested image ${imgUrl}`
    });
  }

  const mimeType = mime.lookup(imgUrl);

  if (mimeType === false) {
    return res.status(400).send({
      code: 400,
      result: 'Unsupported file type'
    })
  }

  switch (action) {
    case 'resize':
      return res
        .type(mimeType)
        .set({'Cache-Control': `max-age=${ONE_YEAR}`})
        .send(await resize(buffer, width, height));
    case 'fit':
      return res
        .type(mimeType)
        .set({'Cache-Control': `max-age=${ONE_YEAR}`})
        .send(await fit(buffer, width, height));
    case 'crop':
      /*return res
        .type(mimeType)
        .set({'Cache-Control': `max-age=${ONE_YEAR}`})
        .send(await crop(buffer, width, height, x, y));*/
    case 'identify':
      return res
        .set({'Cache-Control': `max-age=${ONE_YEAR}`})
        .send(await identify(buffer));
    default:
      throw new Error('Unknown action');
  }
})

function _isUrlWhitelisted(url, whitelistType, defaultValue, whitelist) {
  if(arguments.length != 4) throw new Error('params are not optional!')

  if(whitelist && whitelist.hasOwnProperty(whitelistType)) {
    const requestedHost = URL.parse(url).host;
    const matches = whitelist[whitelistType].map((allowedHost) => {
      allowedHost = ((allowedHost instanceof RegExp) ? allowedHost : new RegExp(allowedHost))
      return !!requestedHost.match(allowedHost)
    })

    return (matches.indexOf(true) > -1)
  } else {
    return defaultValue
  }
}

function isImageSourceHostAllowed(url, whitelist) {
  return _isUrlWhitelisted(url, 'allowedHosts', true, whitelist)
}

function isImageSourceHostTrusted(url, whitelist) {
  return _isUrlWhitelisted(url, 'trustedHosts', false, whitelist)
}

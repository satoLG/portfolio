/**
 * CSS3DRenderer — patched for iOS Safari compatibility.
 *
 * Root cause: three.js r148+ moved the perspective value from
 *   `domElement.style.perspective = fov + 'px'`   (CSS property on parent)
 * to
 *   `cameraElement.style.transform = 'perspective(' + fov + 'px) ' + ...`  (function inside transform)
 *
 * iOS Safari WebKit does not correctly apply perspective() as a CSS function
 * inside a transform when children use preserve-3d — the 3D objects flatten.
 * Setting `perspective` as a CSS property on the parent element works on all
 * browsers including iOS Safari.
 *
 * This file is otherwise identical to three r182 CSS3DRenderer.
 */

import {
    Matrix4,
    Object3D,
    Quaternion,
    Vector3,
} from 'three';
import type { Camera, PerspectiveCamera, OrthographicCamera } from 'three';

// Based on http://www.emagix.net/academic/mscs-project/item/camera-sync-with-css3-and-webgl-threejs

const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();

export class CSS3DObject extends Object3D {

    isCSS3DObject: boolean = true;
    element: HTMLElement;

    constructor( element: HTMLElement = document.createElement( 'div' ) ) {
        super();

        this.element = element;
        this.element.style.position = 'absolute';
        this.element.style.pointerEvents = 'auto';
        this.element.style.userSelect = 'none';

        this.element.setAttribute( 'draggable', 'false' );

        this.addEventListener( 'removed', function ( this: CSS3DObject ) {
            this.traverse( function ( object: Object3D ) {
                const obj = object as CSS3DObject;
                if (
                    obj.element &&
                    obj.element instanceof Element &&
                    obj.element.parentNode !== null
                ) {
                    obj.element.remove();
                }
            } );
        } );
    }

    copy( source: this, recursive: boolean ): this {
        super.copy( source, recursive );
        this.element = source.element.cloneNode( true ) as HTMLElement;
        return this;
    }
}

export class CSS3DSprite extends CSS3DObject {

    isCSS3DSprite: boolean = true;
    rotation2D: number = 0;

    constructor( element?: HTMLElement ) {
        super( element );
    }

    copy( source: this, recursive: boolean ): this {
        super.copy( source, recursive );
        this.rotation2D = source.rotation2D;
        return this;
    }
}

//

const _matrix = new Matrix4();
const _matrix2 = new Matrix4();

export class CSS3DRenderer {

    domElement: HTMLElement;

    private _width: number = 0;
    private _height: number = 0;
    private _widthHalf: number = 0;
    private _heightHalf: number = 0;

    private _cache: { camera: { fov: number; style: string }; objects: WeakMap<object, { style: string }> };
    private _viewElement: HTMLElement;
    private _cameraElement: HTMLElement;

    constructor( parameters: { element?: HTMLElement } = {} ) {

        const domElement = parameters.element !== undefined ? parameters.element : document.createElement( 'div' );
        // Do NOT set overflow:hidden here — WebKit (iOS Safari) enforces the CSS spec rule
        // that any ancestor with overflow≠visible creates a stacking context that flattens
        // preserve-3d children. Chrome ignores this rule; WebKit does not.
        this.domElement = domElement;

        this._cache = {
            camera: { fov: 0, style: '' },
            objects: new WeakMap()
        };

        const viewElement = document.createElement( 'div' );
        viewElement.style.transformOrigin = '0 0';
        viewElement.style.pointerEvents = 'none';
        // Must be preserve-3d so WebKit doesn't flatten the 3D chain at this level.
        // Chrome is lenient (skips this requirement); WebKit enforces that every
        // element in the chain between the perspective root and the CSS3D objects
        // must either have preserve-3d or not interrupt the stacking context.
        viewElement.style.transformStyle = 'preserve-3d';
        domElement.appendChild( viewElement );
        this._viewElement = viewElement;

        const cameraElement = document.createElement( 'div' );
        cameraElement.style.transformStyle = 'preserve-3d';
        viewElement.appendChild( cameraElement );
        this._cameraElement = cameraElement;
    }

    getSize(): { width: number; height: number } {
        return { width: this._width, height: this._height };
    }

    setSize( width: number, height: number ): void {
        this._width = width;
        this._height = height;
        this._widthHalf = width / 2;
        this._heightHalf = height / 2;

        this.domElement.style.width = width + 'px';
        this.domElement.style.height = height + 'px';

        this._viewElement.style.width = width + 'px';
        this._viewElement.style.height = height + 'px';

        this._cameraElement.style.width = width + 'px';
        this._cameraElement.style.height = height + 'px';
    }

    render( scene: Object3D, camera: Camera ): void {

        const perspCamera = camera as PerspectiveCamera;
        const orthoCamera = camera as OrthographicCamera;        const fov = camera.projectionMatrix.elements[ 5 ] * this._heightHalf;

        // iOS Safari fix: set perspective as a CSS property on viewElement
        // (direct parent of cameraElement) rather than as perspective() inside
        // cameraElement's transform string.
        // perspective() in transform breaks CSS3D on iOS WebKit (preserve-3d children flatten).
        // Setting it as a CSS property on the parent works on all browsers.
        if ( this._cache.camera.fov !== fov ) {
            this._viewElement.style.perspective = perspCamera.isPerspectiveCamera ? fov + 'px' : '';
            this._cache.camera.fov = fov;
        }

        // r137-style matrix update — matrixWorldAutoUpdate didn't exist until r144
        if ( ( scene as any ).autoUpdate === true ) scene.updateMatrixWorld();
        if ( camera.parent === null ) camera.updateMatrixWorld();

        let tx = 0, ty = 0;
        if ( orthoCamera.isOrthographicCamera ) {
            tx = - ( orthoCamera.right + orthoCamera.left ) / 2;
            ty = ( orthoCamera.top + orthoCamera.bottom ) / 2;
        }

        const cameraCSSMatrix = orthoCamera.isOrthographicCamera
            ? 'scale(' + fov + ')' +
              'translate(' + epsilon( tx ) + 'px,' + epsilon( ty ) + 'px)' +
              getCameraCSSMatrix( camera.matrixWorldInverse )
            : 'translateZ(' + fov + 'px)' +
              getCameraCSSMatrix( camera.matrixWorldInverse );

        // No perspective() here — it's on domElement.style.perspective above (iOS fix)
        const style = cameraCSSMatrix + 'translate(' + this._widthHalf + 'px,' + this._heightHalf + 'px)';

        if ( this._cache.camera.style !== style ) {
            this._cameraElement.style.transform = style;
            this._cache.camera.style = style;
        }

        this._renderObject( scene, scene, camera, cameraCSSMatrix );
    }

    private _renderObject( object: Object3D, scene: Object3D, camera: Camera, cameraCSSMatrix: string ): void {

        if ( object.visible === false ) {
            this._hideObject( object );
            return;
        }

        const cssObj = object as CSS3DObject;
        if ( cssObj.isCSS3DObject ) {
            const visible = object.layers.test( camera.layers );
            const element = cssObj.element;
            element.style.display = visible ? '' : 'none';

            if ( visible ) {
                ( object as any ).onBeforeRender( this, scene, camera );

                let style: string;

                const sprite = object as CSS3DSprite;
                if ( sprite.isCSS3DSprite ) {
                    _matrix.copy( camera.matrixWorldInverse );
                    _matrix.transpose();
                    if ( sprite.rotation2D !== 0 ) _matrix.multiply( _matrix2.makeRotationZ( sprite.rotation2D ) );
                    object.matrixWorld.decompose( _position, _quaternion, _scale );
                    _matrix.setPosition( _position );
                    _matrix.scale( _scale );
                    _matrix.elements[ 3 ] = 0;
                    _matrix.elements[ 7 ] = 0;
                    _matrix.elements[ 11 ] = 0;
                    _matrix.elements[ 15 ] = 1;
                    style = getObjectCSSMatrix( _matrix );
                } else {
                    style = getObjectCSSMatrix( object.matrixWorld );
                }

                const cachedObject = this._cache.objects.get( object );
                if ( cachedObject === undefined || cachedObject.style !== style ) {
                    element.style.transform = style;
                    this._cache.objects.set( object, { style } );
                }

                if ( element.parentNode !== this._cameraElement ) {
                    this._cameraElement.appendChild( element );
                }

                ( object as any ).onAfterRender( this, scene, camera );
            }
        }

        for ( let i = 0, l = object.children.length; i < l; i++ ) {
            this._renderObject( object.children[ i ], scene, camera, cameraCSSMatrix );
        }
    }

    private _hideObject( object: Object3D ): void {
        const cssObj = object as CSS3DObject;
        if ( cssObj.isCSS3DObject ) cssObj.element.style.display = 'none';
        for ( let i = 0, l = object.children.length; i < l; i++ ) {
            this._hideObject( object.children[ i ] );
        }
    }
}

function epsilon( value: number ): number {
    return Math.abs( value ) < 1e-10 ? 0 : value;
}

function getCameraCSSMatrix( matrix: Matrix4 ): string {
    const e = matrix.elements;
    return 'matrix3d(' +
        epsilon( e[ 0 ] ) + ',' + epsilon( - e[ 1 ] ) + ',' + epsilon( e[ 2 ] ) + ',' + epsilon( e[ 3 ] ) + ',' +
        epsilon( e[ 4 ] ) + ',' + epsilon( - e[ 5 ] ) + ',' + epsilon( e[ 6 ] ) + ',' + epsilon( e[ 7 ] ) + ',' +
        epsilon( e[ 8 ] ) + ',' + epsilon( - e[ 9 ] ) + ',' + epsilon( e[ 10 ] ) + ',' + epsilon( e[ 11 ] ) + ',' +
        epsilon( e[ 12 ] ) + ',' + epsilon( - e[ 13 ] ) + ',' + epsilon( e[ 14 ] ) + ',' + epsilon( e[ 15 ] ) +
    ')';
}

function getObjectCSSMatrix( matrix: Matrix4 ): string {
    const e = matrix.elements;
    return 'translate(-50%,-50%)matrix3d(' +
        epsilon( e[ 0 ] ) + ',' + epsilon( e[ 1 ] ) + ',' + epsilon( e[ 2 ] ) + ',' + epsilon( e[ 3 ] ) + ',' +
        epsilon( - e[ 4 ] ) + ',' + epsilon( - e[ 5 ] ) + ',' + epsilon( - e[ 6 ] ) + ',' + epsilon( - e[ 7 ] ) + ',' +
        epsilon( e[ 8 ] ) + ',' + epsilon( e[ 9 ] ) + ',' + epsilon( e[ 10 ] ) + ',' + epsilon( e[ 11 ] ) + ',' +
        epsilon( e[ 12 ] ) + ',' + epsilon( e[ 13 ] ) + ',' + epsilon( e[ 14 ] ) + ',' + epsilon( e[ 15 ] ) +
    ')';
}
